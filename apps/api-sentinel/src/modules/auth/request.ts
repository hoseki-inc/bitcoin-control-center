import type { FastifyReply, FastifyRequest } from 'fastify'

/** HttpOnly cookie naming this browser. It has no expiry, so it ends when the browser closes. */
export const BROWSER_COOKIE = 'bcc_browser'
/** Each tab sends its own random ID, kept in sessionStorage, so a new tab needs the PIN again. */
export const TAB_HEADER = 'x-bcc-tab'

const BROWSER_KEY_PATTERN = /^[\w-]{43}$/
const TAB_ID_PATTERN = /^[\w-]{16,64}$/

/** What the auth routes need from the HTTP request; absent for in-process callers such as tests. */
export interface RequestAuth {
  browserKey: string | null
  tabId: string | null
  /** Encrypted on the way: HTTPS, directly or through the platform proxy, or a Tor onion address. */
  secure: boolean
  setBrowserKey: (browserKey: string) => void
  clearBrowserKey: () => void
}

function headerValue(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  return value?.split(',')[0]?.trim()
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim()
    }
  }
  return null
}

export function serializeBrowserCookie(value: string, secure: boolean, clear = false): string {
  return [
    `${BROWSER_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
    ...(clear ? ['Max-Age=0'] : []),
  ].join('; ')
}

/** A Tor onion address: Tor encrypts the whole way to the server, so plain HTTP to it is as private as HTTPS. */
function isOnionHost(host: string | undefined): boolean {
  const name = host?.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  return name?.endsWith('.onion') === true
}

/**
 * @param trustForwardedProto Only where a platform proxy sets X-Forwarded-Proto and X-Forwarded-Host (StartOS,
 * Umbrel); elsewhere the client could send them.
 */
export function readRequestAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  trustForwardedProto: boolean,
): RequestAuth {
  const browserKey = readCookie(request.headers.cookie, BROWSER_COOKIE)
  const tabId = headerValue(request.headers[TAB_HEADER])
  const forwardedProto = trustForwardedProto ? headerValue(request.headers['x-forwarded-proto']) : undefined
  const host = trustForwardedProto
    ? (headerValue(request.headers['x-forwarded-host']) ?? headerValue(request.headers.host))
    : headerValue(request.headers.host)
  const https = request.protocol === 'https' || forwardedProto === 'https'
  // The cookie is marked Secure over HTTPS only: some browsers drop a Secure cookie sent over plain HTTP, even to
  // an onion address.
  return {
    browserKey: browserKey !== null && BROWSER_KEY_PATTERN.test(browserKey) ? browserKey : null,
    tabId: tabId !== undefined && TAB_ID_PATTERN.test(tabId) ? tabId : null,
    secure: https || isOnionHost(host),
    setBrowserKey: (value) => void reply.header('set-cookie', serializeBrowserCookie(value, https)),
    clearBrowserKey: () => void reply.header('set-cookie', serializeBrowserCookie('', https, true)),
  }
}
