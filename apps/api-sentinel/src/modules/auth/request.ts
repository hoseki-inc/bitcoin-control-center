import type { FastifyReply, FastifyRequest } from 'fastify'
import { getHeaderValue, getHostname } from '../../request_security'

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
  encrypted: boolean
  setBrowserKey: (browserKey: string) => void
  clearBrowserKey: () => void
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

/** @param trustProxy Only where the platform proxy sets the forwarded headers (`trustsProxyHeaders`). */
export function readRequestAuth(request: FastifyRequest, reply: FastifyReply, trustProxy: boolean): RequestAuth {
  const header = (name: string): string | undefined => getHeaderValue(request.headers[name])
  const browserKey = readCookie(request.headers.cookie, BROWSER_COOKIE)
  const tabId = header(TAB_HEADER)
  const https = request.protocol === 'https' || (trustProxy && header('x-forwarded-proto') === 'https')
  const host = getHostname((trustProxy ? header('x-forwarded-host') : undefined) ?? header('host'))
  // Tor encrypts the whole way to an onion address, so plain HTTP to it is as private as HTTPS. The cookie is
  // marked Secure over HTTPS only: some browsers drop a Secure cookie sent over plain HTTP, even to an onion.
  return {
    browserKey: browserKey !== null && BROWSER_KEY_PATTERN.test(browserKey) ? browserKey : null,
    tabId: tabId !== undefined && TAB_ID_PATTERN.test(tabId) ? tabId : null,
    encrypted: https || host?.endsWith('.onion') === true,
    setBrowserKey: (value) => void reply.header('set-cookie', serializeBrowserCookie(value, https)),
    clearBrowserKey: () => void reply.header('set-cookie', serializeBrowserCookie('', https, true)),
  }
}
