import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Manages a bundled Tor process for SOCKS proxy support.
 * The Tor binary is shipped as an Electron extraResource.
 */
export class TorManager {
  private process: ChildProcess | null = null
  private readonly _socksPort = 9050
  private readonly dataDir: string

  public constructor(appDataDir: string) {
    this.dataDir = path.join(appDataDir, 'tor-data')
  }

  public get socksPort(): number {
    return this._socksPort
  }

  public async start(): Promise<void> {
    if (this.process) {
      return
    }

    fs.mkdirSync(this.dataDir, { recursive: true })

    const torBinary = this.getTorBinaryPath()
    if (!fs.existsSync(torBinary)) {
      console.error(`Tor binary not found at ${torBinary}`)
      return
    }

    this.process = spawn(
      torBinary,
      ['--SocksPort', String(this._socksPort), '--DataDirectory', this.dataDir, '--GeoIPFile', '', '--GeoIPv6File', ''],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    // Wait for Tor to bootstrap
    await new Promise<void>((resolve) => {
      const onData = (data: Buffer): void => {
        const line = data.toString()
        if (line.includes('Bootstrapped 100%')) {
          this.process?.stdout?.off('data', onData)
          resolve()
        }
      }
      this.process?.stdout?.on('data', onData)

      // Timeout after 30 seconds
      setTimeout(() => {
        this.process?.stdout?.off('data', onData)
        resolve()
      }, 30_000)
    })
  }

  public stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
  }

  private getTorBinaryPath(): string {
    // In packaged app, extraResources are at process.resourcesPath
    // In dev, they're relative to the desktop directory
    const resourcesPath = process.resourcesPath ?? path.join(__dirname, '..', '..')
    const binary = process.platform === 'win32' ? 'tor.exe' : 'tor'
    return path.join(resourcesPath, 'tor', binary)
  }
}
