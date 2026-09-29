import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

type SpawnTor = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface TorStatus {
  state: 'stopped' | 'starting' | 'ready' | 'failed'
  message?: string
  /** Tor's own bootstrap percentage while starting. It marks phases, not elapsed time. */
  progress?: number
}

export class TorManager {
  private child: ChildProcess | null = null
  private status: TorStatus = { state: 'stopped' }
  private starting: Promise<TorStatus> | null = null
  private finishStart: (() => void) | null = null
  private stopping: Promise<void> | null = null
  private stopped = false

  // Tor chooses a free loopback port when it starts, so no other program can
  // claim the port between selection and binding.
  private socksPort: number | null = null

  private readonly appDataDir: string
  private readonly binaryPath: string
  private readonly bootstrapTimeout: number
  private readonly spawnProcess: SpawnTor
  private readonly ownerPid: number

  public constructor(
    appDataDir: string,
    binaryPath: string,
    bootstrapTimeout = 120_000,
    spawnProcess: SpawnTor = spawn,
    ownerPid = process.pid,
  ) {
    this.appDataDir = appDataDir
    this.binaryPath = binaryPath
    this.bootstrapTimeout = bootstrapTimeout
    this.spawnProcess = spawnProcess
    this.ownerPid = ownerPid
  }

  public getStatus(): TorStatus {
    return { ...this.status }
  }

  /** The SOCKS proxy of a ready Tor process, or null while Tor is not ready. */
  public getSocksProxy(): { host: string; port: number } | null {
    return this.status.state === 'ready' && this.socksPort !== null ? { host: '127.0.0.1', port: this.socksPort } : null
  }

  public async start(): Promise<TorStatus> {
    if (this.stopped || this.status.state === 'ready') {
      return Promise.resolve(this.getStatus())
    }
    if (this.starting) {
      return this.starting
    }
    // Report the start immediately so a caller polling status never sees a stale failure.
    this.status = { state: 'starting', progress: 0 }
    this.starting = this.launch().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async launch(): Promise<TorStatus> {
    await this.terminateChild()
    if (this.stopped) {
      return this.getStatus()
    }
    this.status = { state: 'starting', progress: 0 }
    const dataDir = path.join(this.appDataDir, 'tor-data')
    try {
      fs.mkdirSync(dataDir, { recursive: true })
      if (!fs.existsSync(this.binaryPath)) {
        this.status = { state: 'failed', message: 'Bundled Tor is missing. Reinstall the desktop app to use Tor.' }
        return this.getStatus()
      }
      this.child = this.spawnProcess(
        this.binaryPath,
        [
          '--SocksPort',
          '127.0.0.1:auto',
          '--DataDirectory',
          dataDir,
          '--GeoIPFile',
          '',
          '--GeoIPv6File',
          '',
          '--Log',
          'notice stdout',
          // Exit if the app dies without stopping Tor; an orphaned process would keep
          // the data directory locked and prevent Tor from starting on relaunch.
          '__OwningControllerProcess',
          String(this.ownerPid),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch {
      this.status = { state: 'failed', message: 'Tor could not start. Turn Tor on to try again.' }
      return this.getStatus()
    }
    const child = this.child
    await new Promise<void>((resolve) => {
      let buffer = ''
      let finished = false
      const finish = (): void => {
        if (finished) {
          return
        }
        finished = true
        clearTimeout(timer)
        child.stdout?.off('data', onData)
        this.finishStart = null
        resolve()
      }
      const fail = (message: string): void => {
        if (!this.stopped && this.child === child && this.status.state !== 'failed') {
          this.status = { state: 'failed', message }
        }
        finish()
      }
      const onData = (chunk: Buffer): void => {
        buffer = (buffer + chunk.toString()).slice(-8192)
        const listener = /Opened Socks listener connection \(ready\) on 127\.0\.0\.1:(\d+)/.exec(buffer)
        if (listener && this.child === child) {
          this.socksPort = Number(listener[1])
        }
        if (/Bootstrapped 100%[^\n]*Done/.test(buffer)) {
          if (this.socksPort === null) {
            fail('Tor did not open its local proxy. Turn Tor on to try again.')
            return
          }
          this.status = { state: 'ready' }
          finish()
          return
        }
        const reported = [...buffer.matchAll(/Bootstrapped (\d{1,2})%/g)].map((match) => Number(match[1]))
        const progress = Math.max(this.status.progress ?? 0, ...reported)
        if (this.status.state === 'starting' && progress !== this.status.progress) {
          this.status = { state: 'starting', progress }
        }
      }
      const timer = setTimeout(() => {
        fail('Tor could not connect within two minutes. Check your network, then turn Tor on to try again.')
      }, this.bootstrapTimeout)
      this.finishStart = finish
      child.stdout?.on('data', onData)
      // Consume both pipes without logging network details or unbounded daemon output.
      child.stdout?.resume()
      child.stderr?.resume()
      child.once('error', () => {
        fail('Tor could not start. Turn Tor on to try again.')
      })
      child.once('exit', () => {
        fail('Tor stopped unexpectedly. Turn Tor on to try again.')
      })
      child.once('close', () => {
        if (this.child === child) {
          this.child = null
          this.socksPort = null
        }
      })
    })
    if (this.status.state === 'failed') {
      await this.terminateChild()
    }
    return this.getStatus()
  }

  public async stop(): Promise<void> {
    if (this.stopping) {
      return this.stopping
    }
    this.stopped = true
    this.status = { state: 'stopped' }
    this.finishStart?.()
    this.stopping = this.terminateChild()
    return this.stopping
  }

  private async terminateChild(): Promise<void> {
    const child = this.child
    if (!child) {
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
      }, 5000)
      child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
    if (this.child === child) {
      this.child = null
      this.socksPort = null
    }
  }
}
