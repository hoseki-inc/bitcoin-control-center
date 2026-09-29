import * as fs from 'node:fs'

// Leave the default Sentinel and Vite development ports available in either startup order.
const DEVELOPMENT_PORTS = new Set([3400, 4269])

/**
 * Reuse a non-development port when possible; a fresh or legacy profile requests
 * an OS-assigned port.
 */
export function readPreferredPort(file: string): number {
  try {
    const port = Number(fs.readFileSync(file, 'utf8').trim())
    if (Number.isInteger(port) && port >= 1024 && port <= 65535 && !DEVELOPMENT_PORTS.has(port)) {
      return port
    }
  } catch {}
  return 0
}

export function writePreferredPort(file: string, port: number): void {
  try {
    fs.writeFileSync(file, `${port}\n`)
  } catch {}
}

/** Bind directly, retry only an occupied port, and remember the port actually in use. */
export async function startOnPreferredPort<T extends { port: number }>(
  file: string,
  start: (port: number) => Promise<T>,
): Promise<T> {
  let server: T
  try {
    server = await start(readPreferredPort(file))
  } catch (error) {
    // Only an occupied port falls back; other failures are real startup errors.
    if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) {
      throw error
    }
    server = await start(0)
  }
  writePreferredPort(file, server.port)
  return server
}
