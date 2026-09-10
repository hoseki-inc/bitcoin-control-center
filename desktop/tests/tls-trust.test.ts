import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { AddressInfo, Socket } from 'node:net'
import * as tls from 'node:tls'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureDesktopTlsTrust } from '../src/tls-trust'

vi.mock('node:tls', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:tls')>()
  return { ...original, getCACertificates: vi.fn(original.getCACertificates) }
})

const originalTls = await vi.importActual<typeof import('node:tls')>('node:tls')
const defaults = originalTls.getCACertificates('default')
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url), 'utf8')
const ca = fixture('ca.crt')
let server: tls.Server
let port: number
const sockets = new Set<Socket>()

beforeEach(async () => {
  vi.mocked(tls.getCACertificates).mockImplementation((type) =>
    type === 'system' ? [ca] : originalTls.getCACertificates(type),
  )
  server = tls.createServer({ key: fixture('server-key.pem'), cert: fixture('server.crt') }, (socket) => socket.end())
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  originalTls.setDefaultCACertificates(defaults)
  vi.clearAllMocks()
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function connect(servername = 'localhost'): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, servername, rejectUnauthorized: true }, () => {
      resolve(socket.authorized)
      socket.destroy()
    })
    socket.once('error', reject)
    socket.setTimeout(2000, () => socket.destroy(new Error('TLS fixture timed out')))
  })
}

describe('desktop system certificate trust', () => {
  it('trusts an OS-approved authority while retaining the existing default authorities', async () => {
    await expect(connect()).rejects.toHaveProperty('code', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
    configureDesktopTlsTrust()
    await expect(connect()).resolves.toBe(true)
    const fingerprints = new Set(
      originalTls.getCACertificates('default').map((pem) => new X509Certificate(pem).fingerprint256),
    )
    expect(defaults.every((pem) => fingerprints.has(new X509Certificate(pem).fingerprint256))).toBe(true)
  })

  it('still rejects a certificate for the wrong server address', async () => {
    configureDesktopTlsTrust()
    await expect(connect('wrong-host.example')).rejects.toHaveProperty('code', 'ERR_TLS_CERT_ALTNAME_INVALID')
  })

  it('keeps untrusted servers rejected when no system authority is configured', async () => {
    vi.mocked(tls.getCACertificates).mockImplementation((type) =>
      type === 'system' ? [] : originalTls.getCACertificates(type),
    )
    configureDesktopTlsTrust()
    await expect(connect()).rejects.toHaveProperty('code', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
  })
})
