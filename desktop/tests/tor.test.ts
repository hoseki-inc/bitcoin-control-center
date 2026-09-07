import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TorManager } from '../src/tor'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
let directory: string
let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
let tor: TorManager

beforeEach(() => {
  vi.useFakeTimers()
  directory = mkdtempSync(join(tmpdir(), 'bcc-tor-test-'))
  writeFileSync(join(directory, 'tor'), '')
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => {
        child.emit('exit', 0)
        child.emit('close', 0)
      })
      return true
    }),
  })
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  tor = new TorManager(directory, join(directory, 'tor'), 19450, 1000)
})
afterEach(async () => {
  await tor.stop()
  vi.clearAllMocks()
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

async function launch(): Promise<Promise<{ state: string }>[]> {
  const pending = tor.start()
  await vi.advanceTimersByTimeAsync(0)
  return [pending]
}

describe('bundled Tor lifecycle', () => {
  it('waits for complete bootstrap output across chunks and binds only its assigned loopback port', async () => {
    const [pending] = await launch()
    expect(tor.start()).toBe(pending)
    child.stdout.write('Bootstrapped 80%: Connecting\nBootstrapped 10')
    expect(tor.getStatus().state).toBe('starting')
    child.stdout.write('0% (done): Done\n')
    expect((await pending).state).toBe('ready')
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('127.0.0.1:19450')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports missing binaries without claiming Tor is ready', async () => {
    rmSync(join(directory, 'tor'))
    expect((await tor.start()).state).toBe('failed')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports spawn errors and drains the child', async () => {
    const [pending] = await launch()
    child.emit('error', new Error('ENOEXEC'))
    child.emit('close', -1)
    expect((await pending).state).toBe('failed')
    expect(tor.getStatus().message).toContain('could not start')
  })

  it('fails a bootstrap timeout, terminates that child, and permits an explicit retry', async () => {
    const [pending] = await launch()
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).state).toBe('failed')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    const [retry] = await launch()
    child.stdout.write('Bootstrapped 100% (done): Done\n')
    expect((await retry).state).toBe('ready')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('revokes readiness when a running Tor process exits', async () => {
    const [pending] = await launch()
    child.stdout.write('Bootstrapped 100% (done): Done\n')
    await pending
    child.emit('exit', 1)
    child.emit('close', 1)
    expect(tor.getStatus().state).toBe('failed')
  })

  it('settles pending startup on quit and never starts another process afterwards', async () => {
    const [pending] = await launch()
    await tor.stop()
    expect((await pending).state).toBe('stopped')
    expect((await tor.start()).state).toBe('stopped')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('waits for child exit and force-kills only its own child if termination stalls', async () => {
    await launch()
    child.kill.mockImplementation((signal) => {
      if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', 0))
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
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
  })
})
