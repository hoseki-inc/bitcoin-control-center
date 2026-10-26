import { isIP } from 'node:net'
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'

const DEFAULT_ALLOWED_HOST_PATTERNS = ['localhost', '127.0.0.1', '::1']
// Matches server.port in apps/control-center/vite.config.ts, which uses strictPort so it never moves.
const VITE_DEV_SERVER_PORT = '4269'

interface AllowedHosts {
  patterns: string[]
  /** Accept any IP-literal host, for platforms that cannot report their LAN or VPN addresses. */
  allowIpAddresses: boolean
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeHostname(address).replace(/^::ffff:/, '')
  return isLoopbackHost(normalized)
}

export function getHostname(host: string | undefined): string | null {
  if (host == null || host === '') {
    return null
  }

  try {
    return normalizeHostname(new URL(`http://${host}`).hostname)
  } catch {
    return null
  }
}

export function getHeaderValue(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  return value?.split(',')[0]?.trim()
}

function normalizeAllowedHostPattern(pattern: string): string | null {
  const trimmed = pattern.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (trimmed.startsWith('*.')) {
    const suffix = normalizeHostname(trimmed.slice(2))
    return suffix.length > 0 ? `*.${suffix}` : null
  }

  const hostname = getHostname(trimmed)
  return hostname ?? normalizeHostname(trimmed)
}

function getAllowedHosts(configuredHosts: string | undefined, allowIpAddresses: boolean): AllowedHosts {
  const configuredPatterns = (configuredHosts ?? '')
    .split(',')
    .map(normalizeAllowedHostPattern)
    .filter((pattern): pattern is string => pattern !== null)

  return { patterns: [...DEFAULT_ALLOWED_HOST_PATTERNS, ...configuredPatterns], allowIpAddresses }
}

function matchesAllowedPattern(hostname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      return hostname === suffix || hostname.endsWith(`.${suffix}`)
    }

    return hostname === pattern
  })
}

function isAllowedHost(host: string | undefined, allowedHosts: AllowedHosts): boolean {
  const hostname = getHostname(host)
  if (hostname == null || hostname === '') {
    return false
  }

  // DNS rebinding needs an attacker-controlled hostname, so an IP-literal host
  // cannot be used to rebind.
  return (
    matchesAllowedPattern(hostname, allowedHosts.patterns) || (allowedHosts.allowIpAddresses && isIP(hostname) !== 0)
  )
}

// In development the UI runs on the Vite dev server, so only its origin may call Sentinel across origins.
function isAllowedDevelopmentOrigin(origin: string | undefined): boolean {
  if (origin == null || origin === '') {
    return true
  }

  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && isLoopbackHost(url.hostname) && url.port === VITE_DEV_SERVER_PORT
  } catch {
    return false
  }
}

// Sentinel serves plain HTTP in development.
function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (host === undefined) {
    return false
  }

  try {
    return new URL(origin).origin === new URL(`http://${host}`).origin
  } catch {
    return false
  }
}

/**
 * Only StartOS and Umbrel configure hosts. Their proxies set X-Forwarded-Host and X-Forwarded-Proto, replacing any
 * value the client sent. Elsewhere nothing sets those headers except the client itself.
 */
export function trustsProxyHeaders(configuredHosts: string | undefined): boolean {
  return (configuredHosts ?? '').trim() !== ''
}

function isAllowedRequestOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowedHosts: AllowedHosts,
  isProduction: boolean,
): boolean {
  if (origin == null || origin === '') {
    return true
  }
  if (!isProduction) {
    const isOwnLoopbackOrigin = isLoopbackHost(getHostname(host) ?? '') && isSameOrigin(origin, host)
    return isAllowedDevelopmentOrigin(origin) || isOwnLoopbackOrigin
  }

  try {
    const hostname = normalizeHostname(new URL(origin).hostname)
    if (matchesAllowedPattern(hostname, allowedHosts.patterns)) {
      return true
    }

    // Trust an IP-literal origin only for requests to that same address;
    // otherwise any page served from an IP address could write to the API.
    return allowedHosts.allowIpAddresses && isIP(hostname) !== 0 && hostname === getHostname(host)
  } catch {
    return false
  }
}

function isUnsafeMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function isJsonContentType(contentType: string | undefined): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

// Routing decodes the path, so an encoded request such as /%74rpc/... still reaches tRPC:
// check the route that will run as well as the raw URL.
function isProtectedRoute(route: string | undefined, url: string): boolean {
  return route?.startsWith('/trpc') === true || url.startsWith('/trpc')
}

export function registerRequestSecurity(
  server: FastifyInstance,
  configuredHosts: string | undefined,
  isProduction: boolean,
  allowIpAddressHosts = false,
): void {
  const allowedHosts = getAllowedHosts(configuredHosts, allowIpAddressHosts)
  // Untrusted, a forwarded host could let a web page (after DNS rebinding, say) pass as localhost: Host must match too.
  const trustForwardedHost = trustsProxyHeaders(configuredHosts)

  server.addHook('onRequest', async (request, reply) => {
    if (!isProtectedRoute(request.routeOptions.url, request.url)) {
      return
    }

    const secFetchSite = getHeaderValue(request.headers['sec-fetch-site'])
    if (secFetchSite === 'cross-site') {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Cross-site requests are not allowed' })
    }

    const forwardedHost = getHeaderValue(request.headers['x-forwarded-host'])
    const host = getHeaderValue(request.headers.host)
    const hostAllowed = trustForwardedHost
      ? isAllowedHost(forwardedHost ?? host, allowedHosts)
      : isAllowedHost(host, allowedHosts) && (forwardedHost === undefined || isAllowedHost(forwardedHost, allowedHosts))
    if (!hostAllowed) {
      return reply.status(403).send({ code: 'forbidden_host', message: 'Host is not allowed' })
    }

    if (!isAllowedRequestOrigin(request.headers.origin, host, allowedHosts, isProduction)) {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Origin is not allowed' })
    }

    if (
      (request.headers.origin == null || request.headers.origin === '') &&
      isUnsafeMethod(request.method) &&
      !isLoopbackAddress(request.ip)
    ) {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Origin is required' })
    }

    // The Origin check matches hostnames only, so a page on another port of an allowed host passes it. That page
    // is same-site, while Control Center's own requests are same-origin. Development is exempt: the Vite dev server
    // calls Sentinel from another port.
    if (isProduction && secFetchSite === 'same-site' && isUnsafeMethod(request.method)) {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Same-site changes are not allowed' })
    }

    // Browsers send Sec-Fetch-Site only to HTTPS and loopback addresses, so none over plain HTTP to a LAN IP or
    // .local name, and Safari sent none before 16.4. Either way they send JSON across origins only after a
    // preflight, which production CORS refuses.
    if (isUnsafeMethod(request.method) && !isJsonContentType(request.headers['content-type'])) {
      return reply
        .status(415)
        .send({ code: 'unsupported_content_type', message: 'Changes must be sent as application/json' })
    }
  })
}

// Production serves the UI from Sentinel's own origin, so it approves no cross-origin preflight.
export async function registerCorsPolicy(server: FastifyInstance, isProduction: boolean): Promise<void> {
  await server.register(cors, {
    origin: isProduction
      ? false
      : (origin, callback) => {
          callback(null, isAllowedDevelopmentOrigin(origin))
        },
    credentials: !isProduction,
  })
}
