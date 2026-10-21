import { hostname } from 'node:os'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, onTestFinished } from 'vitest'
import { HIDDEN_DETAIL, hideWalletDetailsInText, walletDetailLogOptions } from './log_redaction'
import { requestLoggerFactory } from './request_logging'

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const legacyAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
// A valid address with no digit after its first character.
const letterAddress = '1HBWhaTMoBmRthuJsMjnzHTYazKXWBcWtY'
const txid = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16'
const xpub =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
const descriptor = `wpkh([d34db33f/84h/0h/0h]${xpub}/0/*)#8wq4d8f5`
const host = 'electrum.my-home.lan'
const ip = '192.168.1.50'
const onion = 'vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd.onion'
const details = [address, legacyAddress, letterAddress, txid, xpub, descriptor, host, ip, onion]

/** A DNS failure as Node reports it, with the host in its message and fields. */
function notFoundError(): Error {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
    code: 'ENOTFOUND',
    errno: -3008,
    syscall: 'getaddrinfo',
    hostname: host,
  })
}

/** A refused connection as Node reports it, with the IP and port in its message and fields. */
function refusedError(): Error {
  return Object.assign(new Error(`connect ECONNREFUSED ${ip}:50001`), {
    code: 'ECONNREFUSED',
    errno: -61,
    syscall: 'connect',
    address: ip,
    port: 50001,
  })
}

/**
 * Logs every way Sentinel and its Electrum provider record wallet details and hosts. Each line is
 * at Error, so every level writes all of them and no assertion passes because a line was dropped.
 */
function logWalletDetails(level: string): string[] {
  const lines: string[] = []
  const logger = pino(
    { level, ...walletDetailLogOptions(level) },
    {
      write: (line) => {
        lines.push(line)
      },
    },
  )
  logger.error({ address, err: new Error(`Electrum error [1]: unknown address ${address}`) }, 'Failed to list unspent')
  logger.error(
    { txHash: txid, err: new Error(`Electrum error [2]: missing transaction ${txid}`) },
    'Failed to fetch raw tx',
  )
  logger.error({ err: notFoundError() }, 'Electrum is unavailable')
  logger.error({ err: new AggregateError([refusedError()], '') }, 'Electrum is unavailable')
  logger.error({ error: `getaddrinfo ENOTFOUND ${host}` }, 'Failed to initialize application context')
  logger.error({ reason: `connect ECONNREFUSED ${onion}:50001` }, 'Saved connections are unavailable')
  logger.error(refusedError())
  logger.error(refusedError(), 'Electrum %s', `refused ${descriptor}`)
  logger.error({ accounts: [{ descriptor, xpub }] }, 'Accounts')
  logger.child({ module: 'electrum', host }).error({ addresses: [legacyAddress] }, 'Child logger')
  logger.error(`Looked up ${txid}`)
  logger.error('Electrum at %s refused', `${ip}:50001`)
  logger.error({ count: 1 }, 'Received %s', letterAddress)
  return lines
}

const LOGGED_LINES = 13

describe('wallet detail log redaction', () => {
  it.each(['info', 'warn', 'error'])('hides wallet details and hosts at %s', (level) => {
    const lines = logWalletDetails(level)
    const output = lines.join('')

    expect(lines).toHaveLength(LOGGED_LINES)
    for (const detail of details) {
      expect(output).not.toContain(detail)
    }
    expect(output).not.toContain('my-home')
    expect(output).not.toContain(`"hostname":"${hostname()}"`)
    expect(lines[0]).toContain(`"hostname":"${HIDDEN_DETAIL}"`)
    // Error codes, kinds and ports stay, so support logs still say what went wrong and where.
    expect(output).toContain(`"code":"ENOTFOUND"`)
    expect(output).toContain(`"code":"ECONNREFUSED"`)
    expect(output).toContain(`getaddrinfo ENOTFOUND ${HIDDEN_DETAIL}`)
    expect(output).toContain(`connect ECONNREFUSED ${HIDDEN_DETAIL}:50001`)
    expect(output).toContain(`"msg":"connect ECONNREFUSED ${HIDDEN_DETAIL}:50001"`)
    expect(output).toContain(`"msg":"Electrum refused ${HIDDEN_DETAIL}"`)
    expect(output).toContain(`"msg":"Electrum at ${HIDDEN_DETAIL}:50001 refused"`)
  })

  it.each(['debug', 'trace'])('shows wallet details and hosts at %s', (level) => {
    const lines = logWalletDetails(level)
    const output = lines.join('')

    expect(lines).toHaveLength(LOGGED_LINES)
    for (const detail of details) {
      expect(output).toContain(detail)
    }
    expect(output).toContain(`"hostname":"${host}"`)
    expect(output).toContain(`"hostname":"${hostname()}"`)
    expect(output).not.toContain(HIDDEN_DETAIL)
  })

  it('keeps loopback hosts, which identify nothing and tell Tor and Electrum apart', () => {
    expect(hideWalletDetailsInText('connect ECONNREFUSED 127.0.0.1:9050')).toBe('connect ECONNREFUSED 127.0.0.1:9050')
    expect(hideWalletDetailsInText('connect ECONNREFUSED ::1:50001')).toBe('connect ECONNREFUSED ::1:50001')
    expect(hideWalletDetailsInText('connect ECONNREFUSED fd00::5:50001')).toBe(
      `connect ECONNREFUSED ${HIDDEN_DETAIL}:50001`,
    )
    expect(hideWalletDetailsInText('Server listening at http://10.0.0.5:3400')).toBe(
      `Server listening at http://${HIDDEN_DETAIL}:3400`,
    )
  })

  it('keeps ordinary text and stack frames', () => {
    const text = 'Request timeout after 10000ms for blockchain.scripthash.get_history\n    at run (file.ts:12:34)'
    expect(hideWalletDetailsInText(text)).toBe(text)
    expect(hideWalletDetailsInText('read ECONNRESET\n    at TCP.onStreamRead')).toBe(
      'read ECONNRESET\n    at TCP.onStreamRead',
    )
  })

  it('hides long runs of unclosed descriptors quickly', () => {
    const lines: string[] = []
    const logger = pino(
      { level: 'info', ...walletDetailLogOptions('info') },
      {
        write: (line) => {
          lines.push(line)
        },
      },
    )
    // A request path anyone can send, and an error message from a malicious Electrum server.
    const path = `/${'pkh('.repeat(4096)}`
    const message = `Electrum error [1]: ${'wpkh('.repeat(20_000)}`

    const started = performance.now()
    const hiddenPath = hideWalletDetailsInText(path)
    logger.error({ err: new Error(message) }, 'Failed to list unspent')
    const elapsed = performance.now() - started

    // The quadratic pattern took about 7 seconds for these; the bound leaves room for slow CI machines.
    expect(elapsed).toBeLessThan(250)
    expect(hiddenPath).toBe(`/${HIDDEN_DETAIL}`)
    expect(lines.join('')).not.toContain('wpkh(')
    expect(hideWalletDetailsInText(`Account ${descriptor} added`)).toBe(`Account ${HIDDEN_DETAIL} added`)
  })

  it('removes the query before hiding details in missing-route messages at info', async () => {
    const lines: string[] = []
    const logger = pino(
      { level: 'info', ...walletDetailLogOptions('info') },
      {
        write: (line) => {
          lines.push(line)
        },
      },
    )
    const server = Fastify({ loggerInstance: logger, childLoggerFactory: requestLoggerFactory })
    onTestFinished(async () => {
      await server.close()
    })
    const query = `?input=${encodeURIComponent(JSON.stringify({ 0: { json: { xpub } } }))}`

    const response = await server.inject({ url: `/missing/${address}${query}` })

    expect(response.statusCode).toBe(404)
    const output = lines.join('')
    expect(output).toContain(`"msg":"Route GET:/missing/${HIDDEN_DETAIL} not found"`)
    expect(output).not.toContain(address)
    expect(output).not.toContain(xpub)
    expect(output).not.toContain('input=')
  })

  it('hides hosts in request errors at info', async () => {
    const lines: string[] = []
    const logger = pino(
      { level: 'info', ...walletDetailLogOptions('info') },
      {
        write: (line) => {
          lines.push(line)
        },
      },
    )
    const server = Fastify({ loggerInstance: logger, childLoggerFactory: requestLoggerFactory })
    onTestFinished(async () => {
      await server.close()
    })
    server.get('/failure', async () => {
      throw notFoundError()
    })

    const response = await server.inject({ url: '/failure' })

    expect(response.statusCode).toBe(500)
    const output = lines.join('')
    expect(output).not.toContain(host)
    expect(output).not.toContain('127.0.0.1')
    expect(output).toContain(`getaddrinfo ENOTFOUND ${HIDDEN_DETAIL}`)
  })
})
