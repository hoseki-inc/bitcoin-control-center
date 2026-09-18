import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

type SpawnTor = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface TorStatus {
  state: 'stopped' | 'starting' | 'ready' | 'failed'
  message?: string
}

export class TorManager {
  private child: ChildProcess | null = null
  private status: TorStatus = { state: 'stopped' }
  private starting: Promise<TorStatus> | null = null
  private finishStart: (() => void) | null = null
  private stopping: Promise<void> | null = null
  private stopped = false

  private readonly appDataDir: string
  private readonly binaryPath: string
  public readonly socksPort: number
  private readonly bootstrapTimeout: number
  private readonly spawnProcess: SpawnTor

  public constructor(
    appDataDir: string,
    binaryPath: string,
    socksPort: number,
    bootstrapTimeout = 120_000,
    spawnProcess: SpawnTor = spawn,
  ) {
    this.appDataDir = appDataDir
    this.binaryPath = binaryPath
    this.socksPort = socksPort
    this.bootstrapTimeout = bootstrapTimeout
    this.spawnProcess = spawnProcess
  }

  public getStatus(): TorStatus {
    return { ...this.status }
  }

  public async start(): Promise<TorStatus> {
    if (this.stopped || this.status.state === 'ready') {
      return Promise.resolve(this.getStatus())
    }
    if (this.starting) {
      return this.starting
    }
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
    this.status = { state: 'starting' }
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
          `127.0.0.1:${this.socksPort}`,
          '--DataDirectory',
          dataDir,
          '--GeoIPFile',
          '',
          '--GeoIPv6File',
          '',
          '--Log',
          'notice stdout',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch {
      this.status = { state: 'failed', message: 'Tor could not start. Use Test Connection to try again.' }
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
        if (/Bootstrapped 100%[^\n]*Done/.test(buffer)) {
          this.status = { state: 'ready' }
          finish()
        }
      }
      const timer = setTimeout(() => {
        fail('Tor could not connect within two minutes. Check your network and use Test Connection to retry.')
      }, this.bootstrapTimeout)
      this.finishStart = finish
      child.stdout?.on('data', onData)
      // Consume both pipes without logging network details or unbounded daemon output.
      child.stdout?.resume()
      child.stderr?.resume()
      child.once('error', () => {
        fail('Tor could not start. Use Test Connection to try again.')
      })
      child.once('exit', () => {
        fail('Tor stopped unexpectedly. Use Test Connection to try again.')
      })
      child.once('close', () => {
        if (this.child === child) {
          this.child = null
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
    }
  }
}
