import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readPreferredPort, startOnPreferredPort, writePreferredPort } from '../src/preferred-port'

let file: string

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'bcc-port-')), 'port')
})
afterEach(() => rmSync(join(file, '..'), { recursive: true, force: true }))

it('requests an OS-assigned port for fresh profiles, invalid files, and saved development ports', () => {
  expect(readPreferredPort(file)).toBe(0)
  for (const value of ['', 'abc', '80', '70000', '5000.5', '3400', '4269']) {
    writeFileSync(file, value)
    expect(readPreferredPort(file)).toBe(0)
  }
})

it('round-trips the last bound port', () => {
  writePreferredPort(file, 51234)
  expect(readFileSync(file, 'utf8')).toBe('51234\n')
  expect(readPreferredPort(file)).toBe(51234)
})

it('does not prevent startup if the preferred port file cannot be written', async () => {
  expect(() => writePreferredPort(join(file, 'missing', 'port'), 1)).not.toThrow()
  await expect(startOnPreferredPort(join(file, 'missing', 'port'), async () => ({ port: 51234 }))).resolves.toEqual({
    port: 51234,
  })
})

it('does not retry unrelated startup failures or change the saved port', async () => {
  writePreferredPort(file, 51234)
  const start = vi.fn().mockRejectedValue(new Error('Database unavailable'))
  await expect(startOnPreferredPort(file, start)).rejects.toThrow('Database unavailable')
  expect(start).toHaveBeenCalledOnce()
  expect(readPreferredPort(file)).toBe(51234)
})
