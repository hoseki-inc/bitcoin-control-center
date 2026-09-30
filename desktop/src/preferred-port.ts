import * as fs from 'node:fs'

// Leave the default Sentinel and Vite development ports available in either startup order.
const DEVELOPMENT_PORTS = new Set([3400, 4269])
// Windows refuses ports in ranges reserved by Hyper-V, WSL, or Docker with EACCES,
// and those reservations can change on every restart.
const UNAVAILABLE_PORT_CODES = new Set(['EADDRINUSE', 'EACCES'])

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

/** Bind directly, retry only an unavailable port, and remember the port actually in use. */
export async function startOnPreferredPort<T extends { port: number }>(
  file: string,
  start: (port: number) => Promise<T>,
): Promise<T> {
  const preferred = readPreferredPort(file)
  let server: T
  try {
    server = await start(preferred)
  } catch (error) {
    // Fall back only when binding the saved port failed. Other failures, including
    // file errors with the same codes, are real startup errors. Node reports the
    // port only when it is nonzero, so a failed OS-assigned port is not retried.
    const unavailable =
      error instanceof Error &&
      'code' in error &&
      UNAVAILABLE_PORT_CODES.has(String(error.code)) &&
      'syscall' in error &&
      error.syscall === 'listen' &&
      'port' in error &&
      error.port === preferred
    if (!unavailable) {
      throw error
    }
    server = await start(0)
  }
  writePreferredPort(file, server.port)
  return server
}
