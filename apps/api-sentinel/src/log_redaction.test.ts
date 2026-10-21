import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, onTestFinished } from 'vitest'
import { HIDDEN_DETAIL, hideWalletDetailsInText, walletDetailLogOptions } from './log_redaction'
import { requestLoggerFactory } from './request_logging'

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const legacyAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
const txid = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16'
const xpub =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
const descriptor = `wpkh([d34db33f/84h/0h/0h]${xpub}/0/*)#8wq4d8f5`
const host = 'electrum.my-home.lan'
const ip = '192.168.1.50'
const onion = 'vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd.onion'
const details = [address, legacyAddress, txid, xpub, descriptor, host, ip, onion]

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

/** Logs every way Sentinel and its Electrum provider use for wallet details and hosts. */
function logWalletDetails(level: string): string {
  const lines: string[] = []
  const logger = pino(
    { level, ...walletDetailLogOptions(level) },
    {
      write: (line) => {
        lines.push(line)
      },
    },
  )
  logger.warn({ address, err: new Error(`Electrum error [1]: unknown address ${address}`) }, 'Failed to list unspent')
  logger.warn(
    { txHash: txid, err: new Error(`Electrum error [2]: missing transaction ${txid}`) },
    'Failed to fetch raw tx',
  )
  logger.error({ err: notFoundError() }, 'Electrum is unavailable')
  logger.error({ err: new AggregateError([refusedError()], '') }, 'Electrum is unavailable')
  logger.error({ error: `getaddrinfo ENOTFOUND ${host}` }, 'Failed to initialize application context')
  logger.error({ reason: `connect ECONNREFUSED ${onion}:50001` }, 'Saved connections are unavailable')
  logger.error(refusedError())
  logger.info({ accounts: [{ descriptor, xpub }] }, 'Accounts')
  logger.child({ module: 'electrum', host }).info({ addresses: [legacyAddress] }, 'Child logger')
  logger.info(`Looked up ${txid}`)
  return lines.join('')
}

describe('wallet detail log redaction', () => {
  it.each(['info', 'warn', 'error'])('hides wallet details and hosts at %s', (level) => {
    const output = logWalletDetails(level)

    for (const detail of details) {
      expect(output).not.toContain(detail)
    }
    expect(output).not.toContain('my-home')
    expect(output).not.toContain(':50001')
    expect(output).toContain(HIDDEN_DETAIL)
    // Error codes and kinds stay, so support logs still say what went wrong.
    expect(output).toContain(`"code":"ENOTFOUND"`)
    expect(output).toContain(`"code":"ECONNREFUSED"`)
    expect(output).toContain(`getaddrinfo ENOTFOUND ${HIDDEN_DETAIL}`)
    expect(output).toContain(`connect ECONNREFUSED ${HIDDEN_DETAIL}`)
  })

  it.each(['debug', 'trace'])('shows wallet details and hosts at %s', (level) => {
    const output = logWalletDetails(level)

    for (const detail of [address, legacyAddress, txid, xpub, host, ip, onion]) {
      expect(output).toContain(detail)
    }
    expect(output).toContain(`"hostname":"${host}"`)
    expect(output).not.toContain(HIDDEN_DETAIL)
  })

  it('keeps ordinary text and stack frames', () => {
    const text = 'Request timeout after 10000ms for blockchain.scripthash.get_history\n    at run (file.ts:12:34)'
    expect(hideWalletDetailsInText(text)).toBe(text)
    expect(hideWalletDetailsInText('read ECONNRESET\n    at TCP.onStreamRead')).toBe(
      'read ECONNRESET\n    at TCP.onStreamRead',
    )
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
