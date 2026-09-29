import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { readPreferredPort, startOnPreferredPort, writePreferredPort } from '../src/preferred-port'

function portFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bcc-port-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  return join(directory, 'port')
}

it('requests an OS-assigned port for fresh profiles, invalid files, and saved development ports', () => {
  const file = portFile()
  expect(readPreferredPort(file)).toBe(0)
  for (const value of ['', 'abc', '80', '70000', '5000.5', '3400', '4269']) {
    writeFileSync(file, value)
    expect(readPreferredPort(file)).toBe(0)
  }
})

it('round-trips the last bound port', () => {
  const file = portFile()
  writePreferredPort(file, 51234)
  expect(readFileSync(file, 'utf8')).toBe('51234\n')
  expect(readPreferredPort(file)).toBe(51234)
})

it('does not prevent startup if the preferred port file cannot be written', async () => {
  const file = portFile()
  expect(() => {
    writePreferredPort(join(file, 'missing', 'port'), 1)
  }).not.toThrow()
  await expect(startOnPreferredPort(join(file, 'missing', 'port'), async () => ({ port: 51234 }))).resolves.toEqual({
    port: 51234,
  })
})

it('does not retry unrelated startup failures or change the saved port', async () => {
  const file = portFile()
  writePreferredPort(file, 51234)
  const start = vi
    .fn<(port: number) => Promise<{ port: number }>>()
    .mockRejectedValue(new Error('Database unavailable'))
  await expect(startOnPreferredPort(file, start)).rejects.toThrow('Database unavailable')
  expect(start).toHaveBeenCalledOnce()
  expect(readPreferredPort(file)).toBe(51234)
})

it('falls back from an occupied saved port and remembers the new one', async () => {
  const file = portFile()
  writePreferredPort(file, 51234)
  const occupied = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })
  const start = vi.fn<(port: number) => Promise<{ port: number }>>(async (port) => {
    if (port === 51234) {
      throw occupied
    }
    return { port: 52345 }
  })
  await expect(startOnPreferredPort(file, start)).resolves.toEqual({ port: 52345 })
  expect(start.mock.calls).toEqual([[51234], [0]])
  expect(readPreferredPort(file)).toBe(52345)
})

it('reuses the saved port on the next launch', async () => {
  const file = portFile()
  writePreferredPort(file, 51234)
  const start = vi.fn<(port: number) => Promise<{ port: number }>>(async (port) => ({ port }))
  await expect(startOnPreferredPort(file, start)).resolves.toEqual({ port: 51234 })
  expect(start).toHaveBeenCalledExactlyOnceWith(51234)
})
