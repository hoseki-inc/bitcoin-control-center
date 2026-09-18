import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'

export async function findAvailablePort(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!isTcpAddress(address)) {
        server.close()
        reject(new Error('Expected a loopback TCP listener'))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(address.port)
        }
      })
    })
  })
}

function isTcpAddress(address: AddressInfo | string | null): address is AddressInfo {
  return address !== null && typeof address !== 'string'
}
