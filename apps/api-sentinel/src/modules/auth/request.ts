import type { FastifyReply, FastifyRequest } from 'fastify'
import { getHeaderValue, getHostname } from '../../request_security'
import type { Visitor } from './service'

/** HttpOnly cookie naming this browser. It has no expiry, so it ends when the browser closes. */
export const BROWSER_COOKIE = 'bcc_browser'
/** Each tab sends its own random ID, kept in sessionStorage, so a new tab needs the PIN again. */
export const TAB_HEADER = 'x-bcc-tab'

const BROWSER_KEY_PATTERN = /^[\w-]{43}$/
const TAB_ID_PATTERN = /^[\w-]{16,64}$/

/** The visitor, and the cookie the sign-in routes set and clear. */
export interface RequestAuth extends Visitor {
  setBrowserKey: (browserKey: string) => void
  clearBrowserKey: () => void
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.split('=')
    if (key?.trim() === name) {
      return value.join('=').trim()
    }
  }
  return undefined
}

function valid(value: string | undefined, pattern: RegExp): string | null {
  return value !== undefined && pattern.test(value) ? value : null
}

/**
 * Encrypted means HTTPS, or a Tor onion address, which Tor encrypts the whole way to the server. The cookie is marked
 * Secure over HTTPS only: some browsers drop a Secure cookie sent over plain HTTP, even to an onion address.
 *
 * @param trustProxy Only where a platform proxy sets X-Forwarded-Proto and X-Forwarded-Host.
 */
export function readRequestAuth(request: FastifyRequest, reply: FastifyReply, trustProxy: boolean): RequestAuth {
  const header = (name: string): string | undefined => getHeaderValue(request.headers[name])
  const https = request.protocol === 'https' || (trustProxy && header('x-forwarded-proto') === 'https')
  const host = getHostname((trustProxy ? header('x-forwarded-host') : undefined) ?? header('host'))
  const setCookie = (value: string, maxAge: string[]): void => {
    const secure = https ? ['Secure'] : []
    void reply.header(
      'set-cookie',
      [`${BROWSER_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', ...secure, ...maxAge].join('; '),
    )
  }
  return {
    browserKey: valid(readCookie(request.headers.cookie, BROWSER_COOKIE), BROWSER_KEY_PATTERN),
    tabId: valid(header(TAB_HEADER), TAB_ID_PATTERN),
    encrypted: https || host?.endsWith('.onion') === true,
    setBrowserKey: (browserKey) => {
      setCookie(browserKey, [])
    },
    clearBrowserKey: () => {
      setCookie('', ['Max-Age=0'])
    },
  }
}
