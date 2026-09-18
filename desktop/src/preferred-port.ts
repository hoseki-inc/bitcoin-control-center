import * as fs from 'node:fs'

/** The port used by earlier desktop builds, so their browser-stored preferences carry over. */
export const LEGACY_PORT = 3400

/**
 * Browser storage is scoped to the page origin, which includes the port. Reusing
 * the previous port keeps the renderer's stored preferences across launches.
 */
export function readPreferredPort(file: string): number {
  try {
    const port = Number(fs.readFileSync(file, 'utf8').trim())
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port
  } catch {}
  return LEGACY_PORT
}

export function writePreferredPort(file: string, port: number): void {
  try {
    fs.writeFileSync(file, `${port}\n`)
  } catch {}
}

export function isAddressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EADDRINUSE'
}
