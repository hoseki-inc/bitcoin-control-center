import { DerivationPath } from '@hoseki/packages/bitcoin'
import { Wallets } from '@hoseki/packages/testing'
import { expect, it } from 'vitest'
import type { ClaimDto } from '../../trpc/server-types'
import { missingKeyPaths, reconnectedMultisigPath } from './create'

it.each([
  ['pending', '/multisig/re_clmx_1'],
  ['unverified', '/multisig/re_clmx_1'],
  ['verified', '/accounts/re_clmx_1'],
  ['expired', '/accounts/re_clmx_1'],
] as const)('opens a re-imported %s multisig at %s', (status, path) => {
  expect(reconnectedMultisigPath({ id: 're_clmx_1', status })).toBe(path)
})

const keys = Wallets.multisigNativeSegwitAccount.xpubs
const multisigPath = DerivationPath.fromString('m/48h/0h/0h/2h').expect('valid path').toString()
function trackedClaim(status: ClaimDto['status']): Pick<ClaimDto, 'status' | 'keystores'> {
  return {
    status,
    keystores: keys.map((xpub, index) => ({
      id: `re_ks_${index}` as const,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      wallet: null,
      // The second key already has its path.
      derivationPath: index === 1 ? multisigPath : null,
      xpub,
      model: null,
      label: `Key ${index}`,
      isIdentified: false,
    })),
  }
}
const imported = keys.map((xpub) => ({ publicKey: xpub.toString(), derivationPath: multisigPath }))
const importedWithoutPaths = keys.map((xpub) => ({ publicKey: xpub.toString(), derivationPath: null }))

it('fills in key paths a tracked multisig is missing', () => {
  expect(missingKeyPaths(trackedClaim('unverified'), imported)).toEqual([
    { id: 're_ks_0', label: 'Key 0', derivationPath: 'm/48h/0h/0h/2h' },
    { id: 're_ks_2', label: 'Key 2', derivationPath: 'm/48h/0h/0h/2h' },
  ])
})

it('leaves proven multisigs and imports without paths alone', () => {
  expect(missingKeyPaths(trackedClaim('verified'), imported)).toEqual([])
  expect(missingKeyPaths(trackedClaim('unverified'), importedWithoutPaths)).toEqual([])
})
