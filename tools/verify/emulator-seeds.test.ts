import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { MultiSigAccount } from '@hoseki/packages/bitcoin/account'
import { bitcoin } from '@hoseki/packages/bitcoin/lib'
import { Wallet } from '@hoseki/packages/bitcoin/wallet'
import { describe, it } from 'vitest'
import { SEED_ACCOUNTS, indexChain, tipHeight } from './chain'
import {
  EMULATOR_EMPTY,
  EMULATOR_MULTISIG_2OF3,
  EMULATOR_PRIMARY,
  EMULATOR_SECONDARY,
  EMULATOR_SEEDS,
  EMULATOR_SEED_NAMES,
} from './emulator-seeds'
import { EMULATOR_SEED_NAMES as RUN_EMULATOR_SEED_NAMES } from './run'

function addressBalanceSats(address: string): number {
  const script = bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)
  const hash = Buffer.from(createHash('sha256').update(script).digest()).reverse().toString('hex')
  const index = indexChain(tipHeight())
  return (index.unspent.get(hash) ?? []).reduce((sum, utxo) => sum + utxo.value, 0)
}

describe('emulator-seeds', () => {
  it('derives the documented BIP-39 / BIP-32 standard vectors for EMULATOR_PRIMARY', () => {
    assert.equal(
      EMULATOR_PRIMARY.mnemonic,
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    )
    assert.equal(EMULATOR_PRIMARY.masterFingerprint, '73c5da0a')
    assert.equal(EMULATOR_PRIMARY.accounts.legacy.receiveAddress(0).toString(), '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA')
    assert.equal(
      EMULATOR_PRIMARY.accounts.nestedSegwit.receiveAddress(0).toString(),
      '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
    )
    assert.equal(
      EMULATOR_PRIMARY.accounts.nativeSegwit.receiveAddress(0).toString(),
      'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    )
    assert.equal(
      EMULATOR_PRIMARY.accounts.taproot.receiveAddress(0).toString(),
      'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
    )
    assert.ok(EMULATOR_PRIMARY.accounts.nativeSegwit.xpub.toString().startsWith('xpub6CatWdiZiodmUeTDp8LT'))
    assert.ok(EMULATOR_PRIMARY.multisigXpub.toString().startsWith('xpub6DkFAXWQ2dHxq2vatrt9'))
  })

  it('defines distinct deterministic seeds for primary, secondary, and empty', () => {
    assert.equal(EMULATOR_SEED_NAMES, RUN_EMULATOR_SEED_NAMES)
    assert.equal(EMULATOR_SECONDARY.mnemonic, 'all all all all all all all all all all all all')
    assert.equal(EMULATOR_EMPTY.mnemonic, 'legal winner thank year wave sausage worth useful legal winner thank yellow')
    const fingerprints = new Set(Object.values(EMULATOR_SEEDS).map((seed) => seed.masterFingerprint))
    assert.equal(fingerprints.size, 3)
  })

  it('builds a valid origin-tagged 2-of-3 Native SegWit multisig with primary and secondary, excluding empty', () => {
    const wallet = Wallet.Multisig.fromDescriptor(EMULATOR_MULTISIG_2OF3.descriptor).expect(
      'multisig wallet descriptor must parse',
    )
    assert.equal(wallet.scriptType, 'p2wsh')
    assert.equal(wallet.threshold, 2)
    assert.equal(wallet.isSorted, true)
    assert.equal(wallet.keyExpressions.length, 3)

    const parsedAccount = MultiSigAccount.fromDescriptor(EMULATOR_MULTISIG_2OF3.descriptor).expect(
      'multisig account descriptor must parse',
    )
    assert.equal(
      parsedAccount.receiveAddress(0).toString(),
      EMULATOR_MULTISIG_2OF3.account.receiveAddress(0).toString(),
    )

    const cosignerXpubs = new Set(wallet.keyExpressions.map((ke) => ke.xpub.toString()))
    assert.equal(cosignerXpubs.has(EMULATOR_PRIMARY.multisigXpub.toString()), true)
    assert.equal(cosignerXpubs.has(EMULATOR_SECONDARY.multisigXpub.toString()), true)
    assert.equal(cosignerXpubs.has(EMULATOR_EMPTY.multisigXpub.toString()), false)
  })

  it('funds emulator single-sig and 2-of-3 multisig UTXOs on the fake chain while leaving EMULATOR_EMPTY at 0 BTC', () => {
    assert.equal(addressBalanceSats(EMULATOR_PRIMARY.accounts.nativeSegwit.receiveAddress(0).toString()), 20_000_000)
    assert.equal(addressBalanceSats(EMULATOR_PRIMARY.accounts.nestedSegwit.receiveAddress(0).toString()), 15_000_000)
    assert.equal(addressBalanceSats(EMULATOR_PRIMARY.accounts.legacy.receiveAddress(0).toString()), 5_000_000)
    assert.equal(addressBalanceSats(EMULATOR_SECONDARY.accounts.nativeSegwit.receiveAddress(0).toString()), 12_000_000)
    assert.equal(addressBalanceSats(EMULATOR_MULTISIG_2OF3.account.receiveAddress(0).toString()), 30_000_000)

    for (const account of Object.values(EMULATOR_EMPTY.accounts)) {
      for (let i = 0; i < 5; i++) {
        assert.equal(addressBalanceSats(account.receiveAddress(i).toString()), 0)
        assert.equal(addressBalanceSats(account.changeAddress(i).toString()), 0)
      }
    }
  })

  it('keeps SEED_ACCOUNTS unchanged at 3 accounts totaling 1.79999 BTC', () => {
    const keys = Object.keys(SEED_ACCOUNTS)
    assert.deepEqual(keys, ['verified', 'watchSegwit', 'watchTaproot'])

    let totalSats = 0
    for (const { account } of Object.values(SEED_ACCOUNTS)) {
      for (let i = 0; i < 5; i++) {
        totalSats += addressBalanceSats(account.receiveAddress(i).toString())
        totalSats += addressBalanceSats(account.changeAddress(i).toString())
      }
    }
    assert.equal(totalSats, 179_999_000)
  })
})
