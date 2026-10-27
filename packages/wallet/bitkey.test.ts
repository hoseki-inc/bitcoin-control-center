import { describe, expect, it } from 'vitest'
import { MultiSigAccount } from '../bitcoin'
import * as descriptors from '../bitcoin/descriptor_utils'
import { Wallets } from '../testing'
import { parseBitkeyExport } from './bitkey'

const [APP, HARDWARE, SERVER] = Wallets.bitkeyKeys

function branch(index: 0 | 1, keys: readonly string[] = Wallets.bitkeyKeys, threshold = 2): string {
  return `wsh(sortedmulti(${threshold},${keys.map((key) => `${key}/${index}/*`).join(',')}))`
}

describe('parseBitkeyExport', () => {
  it('reads the Bitkey app export and labels keys in Bitkey’s order', () => {
    const result = parseBitkeyExport(Wallets.bitkeyExport).expect('valid Bitkey export')

    expect(result.keys.map((key) => [key.role, key.keyExpression.keyOrigin?.fingerprint])).toEqual([
      ['app', 'a0a76f7a'],
      ['hardware', '18240e16'],
      ['server', 'afc9474a'],
    ])
    expect(result.account.threshold).toBe(2)
    expect(result.account.scriptType).toBe('p2wsh')
    expect(result.account.descriptor()).toMatch(/^wsh\(sortedmulti\(2,.*<0;1>\/\*.*\)\)#\w{8}$/)
  })

  it('stores a descriptor that derives the same addresses as Bitkey’s branches', () => {
    const parsed = parseBitkeyExport(Wallets.bitkeyExport).expect('valid Bitkey export')
    const stored = MultiSigAccount.fromDescriptor(parsed.account.descriptor()).expect('valid stored descriptor')

    for (const change of [0, 1] as const) {
      expect(stored.address(change, 7).toString()).toBe(parsed.account.address(change, 7).toString())
    }
    expect(stored.address(0, 0).toString()).toMatch(/^bc1q/)
  })

  it('keeps each key’s own derivation path, as real exports mix hardened and unhardened ones', () => {
    // A real Bitkey export puts the hardware key on account 1' and Block's key on an unhardened path.
    const keys = [APP, HARDWARE.replace("84'/0'/0'", "84'/0'/1'"), SERVER.replace("84'/0'/0'", '84/0/0')]
    const result = parseBitkeyExport(`External: ${branch(0, keys)}\n\nInternal: ${branch(1, keys)}`).expect(
      'valid Bitkey export',
    )

    expect(result.keys.map((key) => [key.role, key.keyExpression.keyOrigin?.derivationPath?.toString()])).toEqual([
      ['app', 'm/84h/0h/0h'],
      ['hardware', 'm/84h/0h/1h'],
      ['server', 'm/84/0/0'],
    ])
  })

  it('accepts only the external line', () => {
    expect(parseBitkeyExport(branch(0)).isOk()).toBe(true)
    expect(parseBitkeyExport(`External: ${branch(0)}`).isOk()).toBe(true)
  })

  it('accepts descriptors with checksums and Windows line endings', () => {
    const external = descriptors.checksum(branch(0)).expect('checksum')
    const internal = descriptors.checksum(branch(1)).expect('checksum')

    expect(parseBitkeyExport(`External: ${external}\r\n\r\nInternal: ${internal}\r\n`).isOk()).toBe(true)
  })

  it('rejects text that is not a descriptor', () => {
    expect(parseBitkeyExport('').unwrapErr().message).toContain('Paste the wallet descriptor')
    expect(parseBitkeyExport('hello').isErr()).toBe(true)
    expect(parseBitkeyExport(`${branch(0)}\n${branch(1)}`).isErr()).toBe(true)
  })

  it('rejects branches that do not match Bitkey’s receive and change paths', () => {
    expect(parseBitkeyExport(`External: ${branch(1)}\n\nInternal: ${branch(0)}`).isErr()).toBe(true)
  })

  it('rejects mismatched external and internal descriptors', () => {
    const otherInternal = branch(1, [APP, HARDWARE, APP.replace('a0a76f7a', 'deadbeef')])

    expect(parseBitkeyExport(`External: ${branch(0)}\n\nInternal: ${otherInternal}`).isErr()).toBe(true)
  })

  it('rejects multisig wallets that are not 2-of-3', () => {
    const result = parseBitkeyExport(`External: ${branch(0, [APP, HARDWARE, SERVER], 3)}`)

    expect(result.unwrapErr().message).toContain('2-of-3')
  })
})
