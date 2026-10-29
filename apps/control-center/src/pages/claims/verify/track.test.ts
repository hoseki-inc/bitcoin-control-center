import { Wallets } from '@hoseki/packages/testing'
import { assert, describe, expect, it } from 'vitest'
import { parseTrackedWallet } from './track'

// As Sparrow exports it, with each key's fingerprint and derivation path.
const multisigWithOrigins =
  'wsh(sortedmulti(2,[98950b2a/48h/0h/0h/2h]xpub6FF4wJMrZjWwm8PpJhJJcD3uircG7QKMaijiZhiFmBoaNX2MJiyqZmQ1aYAu59VawDppV25P7PVwtFsnynPjMFq8DNwo1sPyNdher6jFEug/<0;1>/*,[1d25c06f/48h/0h/0h/2h]xpub6DfQuReLSBLxpNjNJsTFDKsA3FpoiRVuymrkmKYG7j7sFxdJdnC3DWZg9bahkxQoNqzq6CmYDZPeQhgpL63sBhMFZPvH2CuR6mnaaSiseNJ/<0;1>/*,[1d177351/48h/0h/0h/2h]xpub6F5dv5ncJreUTNJ89xwAfuzLGJ17CfuQeo9jPwQ5CLqyGoAnkN6QZMWtoMi73MREyJbWh4o521Ye3DFuRDhkigf8ocJtW4DadaSszNieAgr/<0;1>/*))#asdthwfj'

describe('parseTrackedWallet', () => {
  it('reads a multisig descriptor and keeps its key origins', () => {
    const wallet = parseTrackedWallet(multisigWithOrigins, 'p2pkh')

    assert(wallet?.kind === 'multisig')
    expect(wallet.account.descriptor()).toBe(Wallets.multisigNativeSegwitAccount.descriptor())
    expect(wallet.input.keystores.map((keystore) => keystore.derivationPath)).toEqual(Array(3).fill('m/48h/0h/0h/2h'))
  })

  it('reads a multisig descriptor without key origins', () => {
    const wallet = parseTrackedWallet(Wallets.multisigNativeSegwitAccount.toString(), 'p2pkh')

    assert(wallet?.kind === 'multisig')
    expect(wallet.account.threshold).toBe(2)
    expect(wallet.input.keystores.map((keystore) => keystore.derivationPath)).toEqual([null, null, null])
  })

  it('reads a multisig export with Ypub keys, as Casa writes it', () => {
    const casa =
      'sh(wsh(sortedmulti(2,[af29b904/]Ypub6ihJP1GWiGzh4wgcmx1n8azoWxa8rsvDjmXLEz9Mk1z64xPFj1cyqBiwtTtvUaiWQJnkuEra7Mo9iZVbgxj8be6M9vmGwwbKixUW9C6GoFD/<0;1>/*,[a6713122/49/0/9]Ypub6iPSKFEXk26Jdhwbahm7fXQRws41PLG7hUaeCRCJQZmU7cdraZ5mBFgSbJUwfBJ6jTKuRvjdACAnU4ufr1h6vwiYyFFngkGgfiCaTPv2eME/<0;1>/*,[e699b76c/49/0/9]Ypub6igtCKM336QNjeE57irwVReUTogipbtuX9pEk2a8Vhz838D7YrXBFiwR9QGrMhD2xqLHrf7yZNRwbAf1Hrijym7oaxj6CqRckGRG3xuseqe/<0;1>/*)))'

    const wallet = parseTrackedWallet(casa, 'p2pkh')

    assert(wallet?.kind === 'multisig')
    expect(wallet.account.scriptType).toBe('p2sh-p2wsh')
    expect(wallet.input.account).toBe(wallet.account.descriptor())
    expect(wallet.input.keystores.map((keystore) => keystore.derivationPath)).toEqual([null, 'm/49/0/9', 'm/49/0/9'])
  })

  it('reads a single-sig descriptor with its own script type', () => {
    const wallet = parseTrackedWallet(Wallets.singlesigNativeSegwitAccount.descriptor(), 'p2pkh')

    expect(wallet).toEqual({ kind: 'singlesig', account: Wallets.singlesigNativeSegwitAccount })
  })

  it('reads a plain xpub with the chosen script type', () => {
    const wallet = parseTrackedWallet(` ${Wallets.taproot.toString()}\n`, 'p2tr')

    expect(wallet).toEqual({ kind: 'singlesig', account: Wallets.singlesigTaprootAccount })
  })

  it.each([
    '',
    'not a wallet',
    'wsh(sortedmulti(2,xpub-garbage))',
    // One cosigner's key from a multisig export.
    'Zpub75MBfc96bjry3P4bf2yixrqZHNsNjttB4abK8h3wdnJWsWTFzuX727FzcZ9Gy1hMQmQL6avc9FhiHUsiphL6uw1ANh5yC8R9wRkCDjWcrpN',
  ])('rejects %j', (input) => {
    expect(parseTrackedWallet(input, 'p2pkh')).toBeNull()
  })

  const key = Wallets.nativeSegwitXpub.toString()
  const cosigners = Wallets.multisigNativeSegwitAccount.xpubs.map((xpub) => xpub.toString())
  it.each([
    ['a Taproot script tree', `tr(${key}/<0;1>/*,{pk(${cosigners[0]}/<0;1>/*)})`],
    ['a Taproot script branch', `tr(${key}/<0;1>/*,pk(${cosigners[0]}/<0;1>/*))`],
    ['a Taproot multisig', `tr(${key}/<0;1>/*,sortedmulti_a(2,${cosigners[0]}/<0;1>/*,${cosigners[1]}/<0;1>/*))`],
    ['a single address', `wpkh(${key}/0/5)`],
    ['another branch', `wpkh(${key}/7/*)`],
    ['a multisig single address', `wsh(sortedmulti(2,${cosigners[0]}/0/5,${cosigners[1]}/0/5))`],
    [
      'a Taproot branch with a plain public key',
      `tr(${key}/<0;1>/*,pk(02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13))`,
    ],
    ['an extra step before the branches', `wpkh(${key}/9/<0;1>/*)`],
    [
      'a multisig with keys on different branches',
      `wsh(sortedmulti(2,${cosigners[0]}/0/*,${cosigners[1]}/1/*,${cosigners[2]}/0/*))`,
    ],
    [
      'a multisig extra step before the branches',
      `wsh(sortedmulti(2,${cosigners[0]}/9/<0;1>/*,${cosigners[1]}/9/<0;1>/*))`,
    ],
  ])('rejects %s, which would be tracked as a different wallet', (_, input) => {
    expect(parseTrackedWallet(input, 'p2pkh')).toBeNull()
  })

  it.each(['/0/*', '/1/*'])('tracks a single-sig descriptor for one branch, %s, as the whole wallet', (branch) => {
    expect(parseTrackedWallet(`wpkh(${key}${branch})`, 'p2pkh')).toEqual({
      kind: 'singlesig',
      account: Wallets.singlesigNativeSegwitAccount,
    })
  })

  it('reads the /** shorthand for receive and change, as BSMS exports write it', () => {
    expect(parseTrackedWallet(`wpkh(${key}/**)`, 'p2pkh')).toEqual({
      kind: 'singlesig',
      account: Wallets.singlesigNativeSegwitAccount,
    })
    const multisig = parseTrackedWallet(
      `wsh(sortedmulti(2,${cosigners.map((cosigner) => `${cosigner}/**`).join(',')}))`,
      'p2pkh',
    )
    assert(multisig?.kind === 'multisig')
    expect(multisig.account.descriptor()).toBe(Wallets.multisigNativeSegwitAccount.descriptor())
  })

  it('reads a receive descriptor pasted with its change descriptor', () => {
    const wallet = parseTrackedWallet(`wpkh(${key}/0/*)\nwpkh(${key}/1/*)`, 'p2pkh')

    expect(wallet).toEqual({ kind: 'singlesig', account: Wallets.singlesigNativeSegwitAccount })
  })
})
