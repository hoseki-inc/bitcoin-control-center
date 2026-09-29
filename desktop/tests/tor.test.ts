import { ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { TorManager } from '../src/tor'

function setup() {
  vi.useFakeTimers()
  const directory = mkdtempSync(join(tmpdir(), 'bcc-tor-test-'))
  writeFileSync(join(directory, 'tor'), '')
  const child = new ChildProcess()
  const stdout = new PassThrough()
  child.stdout = stdout
  child.stderr = new PassThrough()
  const kill = vi.spyOn(child, 'kill').mockImplementation(() => {
    queueMicrotask(() => {
      child.emit('exit', 0)
      child.emit('close', 0)
    })
    return true
  })
  const spawnProcess = vi
    .fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>()
    .mockReturnValue(child)
  const tor = new TorManager(directory, join(directory, 'tor'), 1000, spawnProcess, 4242)
  onTestFinished(async () => {
    await tor.stop()
    vi.restoreAllMocks()
    vi.useRealTimers()
    rmSync(directory, { recursive: true, force: true })
  })
  return { directory, child, stdout, kill, spawnProcess, tor }
}

// Tor reports the loopback port it chose before bootstrap completes.
const LISTENER = 'Opened Socks listener connection (ready) on 127.0.0.1:49321\n'

async function launch(tor: TorManager) {
  const pending = tor.start()
  await vi.advanceTimersByTimeAsync(0)
  return { pending }
}

describe('bundled Tor lifecycle', () => {
  it('waits for complete bootstrap output across chunks and uses the loopback port Tor chose', async () => {
    const { tor, stdout, spawnProcess } = setup()
    const { pending } = await launch(tor)
    const repeated = tor.start()
    stdout.write(`${LISTENER}Bootstrapped 80%: Connecting\nBootstrapped 10`)
    expect(tor.getStatus().state).toBe('starting')
    expect(tor.getSocksProxy()).toBeNull()
    stdout.write('0% (done): Done\n')
    await expect(pending).resolves.toMatchObject({ state: 'ready' })
    await expect(repeated).resolves.toMatchObject({ state: 'ready' })
    expect(tor.getSocksProxy()).toEqual({ host: '127.0.0.1', port: 49321 })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    const args = spawnProcess.mock.calls[0]?.[1] ?? []
    expect(args).toContain('127.0.0.1:auto')
    // Tor exits with the app rather than keeping its data directory locked.
    expect(
      args.slice(args.indexOf('__OwningControllerProcess'), args.indexOf('__OwningControllerProcess') + 2),
    ).toEqual(['__OwningControllerProcess', '4242'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails instead of reporting ready when Tor never opened its proxy', async () => {
    const { tor, stdout } = setup()
    const { pending } = await launch(tor)
    stdout.write('Bootstrapped 100% (done): Done\n')
    await expect(pending).resolves.toMatchObject({ state: 'failed' })
    expect(tor.getSocksProxy()).toBeNull()
  })

  it('reports the start immediately and follows bootstrap progress without going backwards', async () => {
    const { tor, stdout } = setup()
    const pending = tor.start()
    expect(tor.getStatus()).toEqual({ state: 'starting', progress: 0 })
    await vi.advanceTimersByTimeAsync(0)
    stdout.write(`${LISTENER}Bootstrapped 10% (conn_done): Connected to a relay\nBootstrapped 5`)
    expect(tor.getStatus()).toEqual({ state: 'starting', progress: 10 })
    stdout.write('0% (loading_descriptors): Loading relay descriptors\n')
    expect(tor.getStatus()).toEqual({ state: 'starting', progress: 50 })
    stdout.write('Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors\n')
    expect(tor.getStatus().progress).toBe(50)
    stdout.write(`${LISTENER}Bootstrapped 100% (done): Done\n`)
    await expect(pending).resolves.toEqual({ state: 'ready' })
  })

  it('reports missing binaries without claiming Tor is ready', async () => {
    const { tor, directory, spawnProcess } = setup()
    rmSync(join(directory, 'tor'))
    await expect(tor.start()).resolves.toMatchObject({ state: 'failed' })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('reports spawn errors and drains the child', async () => {
    const { tor, child } = setup()
    const { pending } = await launch(tor)
    child.emit('error', new Error('ENOEXEC'))
    child.emit('close', -1)
    await expect(pending).resolves.toMatchObject({ state: 'failed' })
    expect(tor.getStatus().message).toContain('could not start')
  })

  it('fails a bootstrap timeout, terminates that child, and permits an explicit retry', async () => {
    const { tor, stdout, kill, spawnProcess } = setup()
    const { pending } = await launch(tor)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({ state: 'failed' })
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    const { pending: retry } = await launch(tor)
    stdout.write(`${LISTENER}Bootstrapped 100% (done): Done\n`)
    await expect(retry).resolves.toMatchObject({ state: 'ready' })
    expect(spawnProcess).toHaveBeenCalledTimes(2)
  })

  it('revokes readiness when a running Tor process exits', async () => {
    const { tor, child, stdout } = setup()
    const { pending } = await launch(tor)
    stdout.write(`${LISTENER}Bootstrapped 100% (done): Done\n`)
    await pending
    expect(tor.getSocksProxy()).not.toBeNull()
    child.emit('exit', 1)
    child.emit('close', 1)
    expect(tor.getStatus().state).toBe('failed')
    expect(tor.getSocksProxy()).toBeNull()
  })

  it('settles pending startup on quit and never starts another process afterwards', async () => {
    const { tor, spawnProcess } = setup()
    const { pending } = await launch(tor)
    await tor.stop()
    await expect(pending).resolves.toMatchObject({ state: 'stopped' })
    await expect(tor.start()).resolves.toMatchObject({ state: 'stopped' })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
  })

  it('waits for child exit and force-kills only its own child if termination stalls', async () => {
    const { tor, child, kill } = setup()
    const { pending: startup } = await launch(tor)
    kill.mockImplementation((signal) => {
      if (signal === 'SIGKILL') {
        queueMicrotask(() => {
          child.emit('close', 0)
        })
      }
      return true
    })
    let stopped = false
    const pending = tor.stop().then(() => {
      stopped = true
    })
    await vi.advanceTimersByTimeAsync(4999)
    expect(stopped).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    await startup
    expect(kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
  })
})
