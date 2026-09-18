import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { LEGACY_PORT, isAddressInUse, readPreferredPort, writePreferredPort } from '../src/preferred-port'

let file: string

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'bcc-port-')), 'port')
})
afterEach(() => rmSync(join(file, '..'), { recursive: true, force: true }))

it('falls back to the legacy port when nothing valid is saved', () => {
  expect(readPreferredPort(file)).toBe(LEGACY_PORT)
  for (const value of ['', 'abc', '80', '70000', '5000.5']) {
    writeFileSync(file, value)
    expect(readPreferredPort(file)).toBe(LEGACY_PORT)
  }
})

it('round-trips the last bound port', () => {
  writePreferredPort(file, 51234)
  expect(readFileSync(file, 'utf8')).toBe('51234\n')
  expect(readPreferredPort(file)).toBe(51234)
})

it('ignores write failures and recognizes address-in-use errors', () => {
  expect(() => writePreferredPort(join(file, 'missing', 'port'), 1)).not.toThrow()
  expect(isAddressInUse(Object.assign(new Error('listen'), { code: 'EADDRINUSE' }))).toBe(true)
  expect(isAddressInUse(new Error('other'))).toBe(false)
  expect(isAddressInUse(null)).toBe(false)
})
