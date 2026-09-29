import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'node:net'
import * as tls from 'node:tls'
import { describe, expect, it, onTestFinished } from 'vitest'
import { configureDesktopTlsTrust } from '../src/tls-trust'

// Synthetic fixtures generated only for these tests; they are not credentials for any
// real service, and the CA private key is not included. The server certificate is
// signed by the test CA, covers localhost and 127.0.0.1, and expires in September 2036.
// Tests supply the CA as a simulated OS-trusted authority. Never install it in a trust store.
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url), 'utf8')
const ca = fixture('ca.crt')

async function setup() {
  const defaults = tls.getCACertificates('default')
  const sockets = new Set<Socket>()
  const server = tls.createServer({ key: fixture('server-key.pem'), cert: fixture('server.crt') }, (socket) => {
    socket.end()
  })
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })
  onTestFinished(async () => {
    tls.setDefaultCACertificates(defaults)
    for (const socket of sockets) {
      socket.destroy()
    }
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!isTcpAddress(address)) {
    throw new Error('Expected a TCP listener')
  }
  const port = address.port
  return {
    defaults,
    trustSystemAuthority: (certificates: string[] = [ca]): void => {
      configureDesktopTlsTrust((type) => (type === 'system' ? certificates : tls.getCACertificates(type)))
    },
    connect: async (servername = 'localhost'): Promise<boolean> =>
      new Promise((resolve, reject) => {
        const socket = tls.connect({ host: '127.0.0.1', port, servername, rejectUnauthorized: true }, () => {
          resolve(socket.authorized)
          socket.destroy()
        })
        socket.once('error', reject)
        socket.setTimeout(2000, () => {
          socket.destroy(new Error('TLS fixture timed out'))
        })
      }),
  }
}

describe('desktop system certificate trust', () => {
  it('trusts an OS-approved authority while retaining the existing default authorities', async () => {
    const { connect, trustSystemAuthority, defaults } = await setup()
    await expect(connect()).rejects.toHaveProperty('code', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
    trustSystemAuthority()
    await expect(connect()).resolves.toBe(true)
    const fingerprints = new Set(tls.getCACertificates('default').map((pem) => new X509Certificate(pem).fingerprint256))
    expect(defaults.every((pem) => fingerprints.has(new X509Certificate(pem).fingerprint256))).toBe(true)
  })

  it('still rejects a certificate for the wrong server address', async () => {
    const { connect, trustSystemAuthority } = await setup()
    trustSystemAuthority()
    await expect(connect('wrong-host.example')).rejects.toHaveProperty('code', 'ERR_TLS_CERT_ALTNAME_INVALID')
  })

  it('keeps untrusted servers rejected when no system authority is configured', async () => {
    const { connect, trustSystemAuthority } = await setup()
    trustSystemAuthority([])
    await expect(connect()).rejects.toHaveProperty('code', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
  })
})

function isTcpAddress(address: AddressInfo | string | null): address is AddressInfo {
  return address !== null && typeof address !== 'string'
}
