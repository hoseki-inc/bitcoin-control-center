import { type AddressInfo, createServer } from 'node:net'

export async function findAvailablePort(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}
