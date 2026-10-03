import type { FastifyInstance } from 'fastify'

const DEFAULT_ALLOWED_HOST_PATTERNS = ['localhost', '127.0.0.1', '::1']

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

function getHostname(host: string | undefined): string | null {
  if (host == null || host === '') {
    return null
  }

  try {
    return normalizeHostname(new URL(`http://${host}`).hostname)
  } catch {
    return null
  }
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
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

function getAllowedHostPatterns(configuredHosts: string | undefined): string[] {
  const configuredPatterns = (configuredHosts ?? '')
    .split(',')
    .map(normalizeAllowedHostPattern)
    .filter((pattern): pattern is string => pattern !== null)

  return [...DEFAULT_ALLOWED_HOST_PATTERNS, ...configuredPatterns]
}

function isAllowedHost(host: string | undefined, allowedPatterns: string[]): boolean {
  const hostname = getHostname(host)
  if (hostname == null || hostname === '') {
    return false
  }

  return allowedPatterns.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      return hostname === suffix || hostname.endsWith(`.${suffix}`)
    }

    return hostname === pattern
  })
}

export function isAllowedDevelopmentOrigin(origin: string | undefined): boolean {
  if (origin == null || origin === '') {
    return true
  }

  try {
    const url = new URL(origin)
    return isLoopbackHost(url.hostname)
  } catch {
    return false
  }
}

function isAllowedRequestOrigin(
  origin: string | undefined,
  allowedHostPatterns: string[],
  isProduction: boolean,
): boolean {
  if (origin == null || origin === '') {
    return true
  }
  if (!isProduction) {
    return isAllowedDevelopmentOrigin(origin)
  }

  try {
    const originUrl = new URL(origin)
    return allowedHostPatterns.some((pattern) => {
      const hostname = normalizeHostname(originUrl.hostname)
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2)
        return hostname === suffix || hostname.endsWith(`.${suffix}`)
      }

      return hostname === pattern
    })
  } catch {
    return false
  }
}

function isUnsafeMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
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
): void {
  const allowedHostPatterns = getAllowedHostPatterns(configuredHosts)
  // Only StartOS configures hosts, because its proxy connects through an internal host and passes the
  // address you used in X-Forwarded-Host. Elsewhere nothing sets that header except the client itself,
  // so a web page (after DNS rebinding, say) could use it to pass as localhost: there, Host must match too.
  const trustForwardedHost = (configuredHosts ?? '').trim() !== ''

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
      ? isAllowedHost(forwardedHost ?? host, allowedHostPatterns)
      : isAllowedHost(host, allowedHostPatterns) &&
        (forwardedHost === undefined || isAllowedHost(forwardedHost, allowedHostPatterns))
    if (!hostAllowed) {
      return reply.status(403).send({ code: 'forbidden_host', message: 'Host is not allowed' })
    }

    if (!isAllowedRequestOrigin(request.headers.origin, allowedHostPatterns, isProduction)) {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Origin is not allowed' })
    }

    if (
      (request.headers.origin == null || request.headers.origin === '') &&
      isUnsafeMethod(request.method) &&
      !isLoopbackAddress(request.ip)
    ) {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Origin is required' })
    }
  })
}
