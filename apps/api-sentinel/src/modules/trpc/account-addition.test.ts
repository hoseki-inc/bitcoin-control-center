import { checksum } from '@hoseki/packages/bitcoin/descriptor_utils'
import { bs58check } from '@hoseki/packages/bitcoin/lib'
import { describe, expect, it } from 'vitest'
import { accounts, keystores } from '../../db/schema'
import { setupAppCaller } from './ownership.fixtures'

it('rejects accounts and claims whose descriptor holds an extended private key', async () => {
  const { caller, db } = await setupAppCaller()
  // BIP32 test vectors 1 (m, m/0H) and 2 (m/0): published vectors, not real wallets.
  const xprv =
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'
  const cosignerXprv =
    'xprv9uHRZZhk6KAJC1avXpDAp4MDc3sQKNxDiPvvkX8Br5ngLNv1TxvUxt4cV1rGL5hj6KCesnDYUhd7oWgT11eZG7XnxHrnYeSvkzY7d2bhkJ7'
  const cosignerXpub =
    'xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH'
  // The same key with SLIP-132 zprv version bytes, as Electrum shows master private keys.
  const zprv = bs58check.encode(Buffer.concat([Buffer.from('04b2430c', 'hex'), bs58check.decode(xprv).subarray(4)]))
  const claims = caller.portalProve.accounts.create

  await expect(
    claims.singlesig({
      network: 'bitcoin_mainnet',
      account: `wpkh([3442193e/84h/0h/0h]${xprv}/0/*)`,
      displayName: 'Private',
      keystore: { label: 'Key', wallet: null, model: null, derivationPath: null },
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  // The parser reads only the internal key, so the private key hides in the script branch.
  await expect(
    claims.singlesig({
      network: 'bitcoin_mainnet',
      account: checksum(`tr(${cosignerXpub}/<0;1>/*,pk(${xprv}/<0;1>/*))`).expect('checksum'),
      displayName: 'Private',
      keystore: { label: 'Key', wallet: null, model: null, derivationPath: null },
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await expect(
    claims.singlesig({
      network: 'bitcoin_mainnet',
      account: checksum(`tr(${cosignerXpub}/<0;1>/*,pk(${zprv}/<0;1>/*))`).expect('checksum'),
      displayName: 'Private',
      keystore: { label: 'Key', wallet: null, model: null, derivationPath: null },
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await expect(
    claims.multisig({
      network: 'bitcoin_mainnet',
      account: `wsh(sortedmulti(2,[3442193e/0h]${cosignerXprv}/<0;1>/*,[bd16bee5/0]${cosignerXpub}/<0;1>/*))`,
      displayName: 'Private',
      keystores: [cosignerXprv, cosignerXpub].map((publicKey) => ({
        label: 'Key',
        wallet: null,
        model: null,
        derivationPath: null,
        publicKey,
      })),
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await expect(db.select().from(accounts)).resolves.toEqual([])
  await expect(db.select().from(keystores)).resolves.toEqual([])
})

describe('descriptor error messages', () => {
  const privateKeyMessage = 'Use extended public keys (xpub), not private keys'
  // BIP32 test vectors 1 (m, m/0H): published vectors, not real wallets.
  const xprv =
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'
  const xpub =
    'xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH'
  const keystore = { label: 'Key', wallet: null, model: null, derivationPath: null }

  // Exactly one issue, because the error formatter shows a lone issue's message and otherwise lists the fields.
  function rejectedWith(message: string) {
    return { code: 'BAD_REQUEST', cause: { issues: [{ message }] } }
  }

  it.each([
    ['the only key', `wpkh([3442193e/84h/0h/0h]${xprv}/<0;1>/*)`],
    ['a later key', checksum(`tr(${xpub}/<0;1>/*,pk(${xprv}/<0;1>/*))`).expect('checksum')],
  ])('names a private key as %s of a singlesig descriptor', async (_, account) => {
    const { caller } = await setupAppCaller()

    await expect(
      caller.portalProve.accounts.create.singlesig({
        network: 'bitcoin_mainnet',
        account,
        displayName: 'Private',
        keystore,
      }),
    ).rejects.toMatchObject(rejectedWith(privateKeyMessage))
  })

  it.each([
    ['the first key', `wsh(sortedmulti(2,[3442193e/0h]${xprv}/<0;1>/*,[bd16bee5/0]${xpub}/<0;1>/*))`],
    ['a later key', `wsh(sortedmulti(2,[bd16bee5/0]${xpub}/<0;1>/*,[3442193e/0h]${xprv}/<0;1>/*))`],
  ])('names a private key as %s of a multisig descriptor', async (_, account) => {
    const { caller } = await setupAppCaller()

    await expect(
      caller.portalProve.accounts.create.multisig({
        network: 'bitcoin_mainnet',
        account,
        displayName: 'Private',
        keystores: [{ ...keystore, publicKey: xpub }],
      }),
    ).rejects.toMatchObject(rejectedWith(privateKeyMessage))
  })

  it('keeps the invalid descriptor message when no key is private', async () => {
    const { caller } = await setupAppCaller()
    const claims = caller.portalProve.accounts.create

    await expect(
      claims.singlesig({ network: 'bitcoin_mainnet', account: 'not-a-descriptor', displayName: 'Bad', keystore }),
    ).rejects.toMatchObject(rejectedWith('Invalid singlesig account descriptor'))
    await expect(
      claims.multisig({ network: 'bitcoin_mainnet', account: 'not-a-descriptor', displayName: 'Bad', keystores: [] }),
    ).rejects.toMatchObject(rejectedWith('Invalid multisig account descriptor'))
  })

  it('accepts singlesig and multisig descriptors with only public keys', async () => {
    const { caller } = await setupAppCaller()
    const secondXpub =
      'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
    const claims = caller.portalProve.accounts.create

    await expect(
      claims.singlesig({
        network: 'bitcoin_mainnet',
        account: `wpkh(${xpub}/<0;1>/*)`,
        displayName: 'Single',
        keystore,
        trackOnly: true,
      }),
    ).resolves.toMatchObject({ claim: { status: 'unverified' } })
    await expect(
      claims.multisig({
        network: 'bitcoin_mainnet',
        account: `wsh(sortedmulti(2,${xpub}/<0;1>/*,${secondXpub}/<0;1>/*))`,
        displayName: 'Multi',
        keystores: [xpub, secondXpub].map((publicKey) => ({
          label: 'Key',
          wallet: null,
          model: null,
          derivationPath: null,
          publicKey,
        })),
        trackOnly: true,
      }),
    ).resolves.toMatchObject({ claim: { status: 'unverified' } })
  })
})
