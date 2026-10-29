import { DerivationPath } from '@hoseki/packages/bitcoin'
import { Wallets } from '@hoseki/packages/testing'
import { expect, it } from 'vitest'
import { claimFixture } from '../testing/claims'
import type { ClaimDto, KeystoreDto } from '../trpc/server-types'
import { deviceUpdateFor } from './claim-flow'

const keystore: KeystoreDto = {
  id: 're_ks_1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  wallet: null,
  derivationPath: null,
  xpub: Wallets.nativeSegwitXpub,
  model: null,
  label: 'Default Keystore',
  isIdentified: false,
}
const path = DerivationPath.fromString("m/84'/0'/0'").expect('valid path')
const savedPath = DerivationPath.fromString('m/84h/0h/0h').expect('valid path').toString()
const ledger = { wallet: 'ledger', model: 'nanoX', derivationPath: path } as const

function claim(status: ClaimDto['status'], isArchived = false): ClaimDto {
  return { ...claimFixture('re_clmx_1', 'Cold storage'), status, isArchived, keystores: [keystore] }
}

it.each(['pending', 'unverified'] as const)('saves the connected device onto a %s account', (status) => {
  expect(deviceUpdateFor(claim(status), ledger)).toEqual({
    id: 're_ks_1',
    label: 'Default Keystore',
    wallet: 'ledger',
    model: 'nanoX',
    derivationPath: ledger.derivationPath.toString(),
  })
})

it('leaves proven and archived accounts alone, and accounts already set up the way they were reached', () => {
  expect(deviceUpdateFor(claim('verified'), ledger)).toBeNull()
  expect(deviceUpdateFor(claim('expired'), ledger)).toBeNull()
  expect(deviceUpdateFor(claim('unverified', true), ledger)).toBeNull()
  expect(deviceUpdateFor(claim('unverified'), { wallet: null, model: null, derivationPath: null })).toBeNull()
})

it('switches to Manually Sign after a device was connected but never signed', () => {
  const withLedger: ClaimDto = {
    ...claim('unverified'),
    keystores: [{ ...keystore, wallet: 'ledger', model: 'nanoX', derivationPath: savedPath, isIdentified: true }],
  }

  expect(deviceUpdateFor(withLedger, { wallet: null, model: null, derivationPath: null })).toEqual({
    id: 're_ks_1',
    label: 'Default Keystore',
    wallet: null,
    model: null,
    derivationPath: savedPath,
  })
})

it('keeps a saved path when the device gives none', () => {
  const saved: ClaimDto = { ...claim('unverified'), keystores: [{ ...keystore, derivationPath: savedPath }] }
  expect(deviceUpdateFor(saved, { ...ledger, derivationPath: null })).toMatchObject({ derivationPath: savedPath })
})
