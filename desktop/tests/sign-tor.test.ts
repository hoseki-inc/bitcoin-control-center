import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { checkMacTorBinaries } from '../src/scripts/sign-tor'

function bundle(files: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'bcc-tor-bundle-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  for (const file of files) {
    writeFileSync(join(directory, file), '')
  }
  return directory
}

describe('macOS Tor signing list', () => {
  it('accepts a list naming Tor and every bundled library', () => {
    const directory = bundle(['tor', 'libevent-2.1.7.dylib', 'torrc-defaults'])
    expect(() => {
      checkMacTorBinaries(directory, ['Contents/Resources/tor/libevent-2.1.7.dylib', 'Contents/Resources/tor/tor'])
    }).not.toThrow()
  })

  it('names the bundled files when a Tor update changes its libraries', () => {
    const directory = bundle(['tor', 'libevent-2.1.12.dylib'])
    expect(() => {
      checkMacTorBinaries(directory, ['Contents/Resources/tor/tor', 'Contents/Resources/tor/libevent-2.1.7.dylib'])
    }).toThrow('Contents/Resources/tor/libevent-2.1.12.dylib, Contents/Resources/tor/tor')
  })
})
