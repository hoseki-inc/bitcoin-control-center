import { assert, describe, expect, it, test } from 'vitest'
import { MultiSigAccount, SingleSigAccount, sortXpubs } from './account'
import { Network } from './network'
import { Xpub } from './xpub'

const XPUB_STR =
  'xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr'
const XPUB = Xpub.fromString(XPUB_STR).expect('valid account')

const TPUB_STR =
  'tpubDD79jZKTZMENaFCfsbnRp3vS3jL4qbrQXUXc8egs34ixe8ovvkUBRx9U1YHkk3aiQfGzLijUEVkjCBSDPT2DxN4NWKzZT9cT3RGkBm7NzcA'
const TPUB = Xpub.fromString(TPUB_STR).expect('valid account')

describe('SingleSigAccount', () => {
  test('descriptor', () => {
    const acc0 = new SingleSigAccount('p2pkh', XPUB)
    expect(acc0.descriptor()).toBe(`pkh(${XPUB_STR}/<0;1>/*)#kdnywuy7`)
    expect(acc0.network()).toEqual(Network.Mainnet)

    const acc1 = new SingleSigAccount('p2sh-p2wpkh', XPUB)
    expect(acc1.descriptor()).toBe(`sh(wpkh(${XPUB_STR}/<0;1>/*))#una0ueqx`)
    expect(acc1.network()).toEqual(Network.Mainnet)

    const acc2 = new SingleSigAccount('p2wpkh', XPUB)
    expect(acc2.descriptor()).toBe(`wpkh(${XPUB_STR}/<0;1>/*)#l3xcgp8q`)
    expect(acc2.network()).toEqual(Network.Mainnet)

    const acc3 = new SingleSigAccount('p2tr', XPUB)
    expect(acc3.descriptor()).toBe(`tr(${XPUB_STR}/<0;1>/*)#40y9k7ac`)
    expect(acc3.network()).toEqual(Network.Mainnet)

    const acc4 = new SingleSigAccount('p2pkh', TPUB)
    expect(acc4.descriptor()).toBe(`pkh(${TPUB_STR}/<0;1>/*)#c4nu0fm0`)
    expect(acc4.network()).toEqual(Network.Testnet)

    const acc5 = new SingleSigAccount('p2sh-p2wpkh', TPUB)
    expect(acc5.descriptor()).toBe(`sh(wpkh(${TPUB_STR}/<0;1>/*))#5aznr2h2`)
    expect(acc5.network()).toEqual(Network.Testnet)

    const acc6 = new SingleSigAccount('p2wpkh', TPUB)
    expect(acc6.descriptor()).toBe(`wpkh(${TPUB_STR}/<0;1>/*)#sh2qurlp`)
    expect(acc6.network()).toEqual(Network.Testnet)

    const acc7 = new SingleSigAccount('p2tr', TPUB)
    expect(acc7.descriptor()).toBe(`tr(${TPUB_STR}/<0;1>/*)#j4rhkue7`)
    expect(acc7.network()).toEqual(Network.Testnet)
  })

  test('address', () => {
    // Test cases copied from Sparrow wallet
    const fixtures = [
      {
        scriptType: 'p2pkh',
        xpub: XPUB,
        address: '1DEHepkTv7vix38wQoRb7e16oZ3wU5BzBz',
      },
      {
        scriptType: 'p2sh-p2wpkh',
        xpub: XPUB,
        address: '3NkucHdjn2MnqYoG5tgVwqeFiqUd1HTT8f',
      },
      {
        scriptType: 'p2wpkh',
        xpub: XPUB,
        address: 'bc1qscjdzs2wgjcnwsdaeddtv7dr88a5qq4hmwn3dt',
      },
      {
        scriptType: 'p2tr',
        xpub: XPUB,
        address: 'bc1pzqwutd8tckudavxnc4g3h6mdz34wv4vxk9u4hxpql84perarckcsq9p58z',
      },
      {
        scriptType: 'p2pkh',
        xpub: TPUB,
        address: 'mvkv2KK1zwL6hiXeDdhpPhcWpuSc3QvYHt',
      },
      {
        scriptType: 'p2sh-p2wpkh',
        xpub: TPUB,
        address: '2N67ZM3rBXaPk8hsDFWQk6pEKuwjrLNaKDM',
      },
      {
        scriptType: 'p2wpkh',
        xpub: TPUB,
        address: 'tb1q5ukaqm7g3ff66medcduxm568r4zqvr3wzyax07',
      },
      {
        scriptType: 'p2tr',
        xpub: TPUB,
        address: 'tb1pktjm8jy9mlrdggcjyh2gnn6geme08cjs5fgfnes028sm0703zldstn5fcq',
      },
    ] as const

    for (const fixture of fixtures) {
      const acc = new SingleSigAccount(fixture.scriptType, fixture.xpub)
      expect(acc.address(0, 0).toString()).toEqual(fixture.address)
    }
  })
})

describe('MultiSigAccount', () => {
  const xpub1 = Xpub.fromString(
    'xpub6CtjWkC5yoLM9Ch2t3uizXEA3FX1tVHnRNqERyTR9eQFzB8xFBDY8XREyjfrHNvX3jrg2nDzi6NEUX2PC1hFKHY5JU1vHPwsBBm9ECjmJo5',
  ).expect('valid account')
  const xpub2 = Xpub.fromString(
    'xpub6CDzRgxbbJwUSn6wkhVepiHoSQ68K1cV3kkZvg3SZR926R2n2VBUJb9feW8duhgbFvTWxzjEv5TpzRop2sNyiQfAStWv4aAwKhzDCrHNwfe',
  ).expect('valid account')
  const xpub3 = Xpub.fromString(
    'xpub6DFvDdFakAWiAXz6At8B66TadzP7S8f8Wrm2VcNtjeXQUMKZDTBEZUaS7KpnkpvbNRAsMaoab1YMPGcCxcxQWmWpMPwiNBvkzvHifDzq2Vi',
  ).expect('valid account')

  const tpub1 = Xpub.fromString(
    'tpubDA5fLNXHCWA66cw48AsL7YzzBxRfTfisx6d56gaYqPhNYGzdQjNYy6w3c26dY1YXc346MtPsuFXfpaaPochNmBVFB7H2gUGjUgorGy7Ntz4',
  ).expect('valid account')
  const tpub2 = Xpub.fromString(
    'tpubD8TtvT4c31CABVQN8UiwAVGC2SqNLJ9rquQ2dXTvsjpXJx2Dgb6isqZudFN925CDPhW2erxLraNZq1VHLVLdTsiBS7aHhHGMkAMFvuAUqwB',
  ).expect('valid account')
  const tpub3 = Xpub.fromString(
    'tpubD9cuoeUV5JFyKDvKXHJ4x9rEUSHG37RsSRuoTi1BfeZzghBdc84pnNCXYj3CkLx3KivSVwvnTFKQF6v8f8UUApaqBN6i8L2ck1cWKN6qeHZ',
  ).expect('valid account')

  test('descriptor', () => {
    const threshold = 2
    const xpubs = [xpub1, xpub2, xpub3]
    const tpubs = [tpub1, tpub2, tpub3]

    const [sortedXpub1, sortedXpub2, sortedXpub3] = sortXpubs(xpubs)
    assert.exists(sortedXpub1, 'Expected sorted xpubs to contain three keys')
    assert.exists(sortedXpub2, 'Expected sorted xpubs to contain three keys')
    assert.exists(sortedXpub3, 'Expected sorted xpubs to contain three keys')
    const [sortedTpub1, sortedTpub2, sortedTpub3] = sortXpubs(tpubs)
    assert.exists(sortedTpub1, 'Expected sorted tpubs to contain three keys')
    assert.exists(sortedTpub2, 'Expected sorted tpubs to contain three keys')
    assert.exists(sortedTpub3, 'Expected sorted tpubs to contain three keys')

    const fixtures = [
      {
        isSorted: false,
        threshold,
        xpubs,
        scriptType: 'p2sh',
        descriptor: `sh(multi(2,${xpub1.toString()}/<0;1>/*,${xpub2.toString()}/<0;1>/*,${xpub3.toString()}/<0;1>/*))#qcszll47`,
      },
      {
        isSorted: true,
        threshold,
        xpubs,
        scriptType: 'p2sh',
        descriptor: `sh(sortedmulti(2,${sortedXpub1.toString()}/<0;1>/*,${sortedXpub2.toString()}/<0;1>/*,${sortedXpub3.toString()}/<0;1>/*))#vv74t2uj`,
      },
      {
        isSorted: false,
        threshold,
        xpubs,
        scriptType: 'p2sh-p2wsh',
        descriptor: `sh(wsh(multi(2,${xpub1.toString()}/<0;1>/*,${xpub2.toString()}/<0;1>/*,${xpub3.toString()}/<0;1>/*)))#h7g5m7e5`,
      },
      {
        isSorted: true,
        threshold,
        xpubs,
        scriptType: 'p2sh-p2wsh',
        descriptor: `sh(wsh(sortedmulti(2,${sortedXpub1.toString()}/<0;1>/*,${sortedXpub2.toString()}/<0;1>/*,${sortedXpub3.toString()}/<0;1>/*)))#qlsug8yc`,
      },
      {
        isSorted: false,
        threshold,
        xpubs,
        scriptType: 'p2wsh',
        descriptor: `wsh(multi(2,${xpub1.toString()}/<0;1>/*,${xpub2.toString()}/<0;1>/*,${xpub3.toString()}/<0;1>/*))#72h5rpmn`,
      },
      {
        isSorted: true,
        threshold,
        xpubs,
        scriptType: 'p2wsh',
        descriptor: `wsh(sortedmulti(2,${sortedXpub1.toString()}/<0;1>/*,${sortedXpub2.toString()}/<0;1>/*,${sortedXpub3.toString()}/<0;1>/*))#wx4sj5ka`,
      },
      {
        isSorted: false,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2sh',
        descriptor: `sh(multi(2,${tpub1.toString()}/<0;1>/*,${tpub2.toString()}/<0;1>/*,${tpub3.toString()}/<0;1>/*))#vln6rvk7`,
      },
      {
        isSorted: true,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2sh',
        descriptor: `sh(sortedmulti(2,${sortedTpub1.toString()}/<0;1>/*,${sortedTpub2.toString()}/<0;1>/*,${sortedTpub3.toString()}/<0;1>/*))#wvujtf83`,
      },
      {
        isSorted: false,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2sh-p2wsh',
        descriptor: `sh(wsh(multi(2,${tpub1.toString()}/<0;1>/*,${tpub2.toString()}/<0;1>/*,${tpub3.toString()}/<0;1>/*)))#yymaxc4x`,
      },
      {
        isSorted: true,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2sh-p2wsh',
        descriptor: `sh(wsh(sortedmulti(2,${sortedTpub1.toString()}/<0;1>/*,${sortedTpub2.toString()}/<0;1>/*,${sortedTpub3.toString()}/<0;1>/*)))#9uuwa920`,
      },
      {
        isSorted: false,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2wsh',
        descriptor: `wsh(multi(2,${tpub1.toString()}/<0;1>/*,${tpub2.toString()}/<0;1>/*,${tpub3.toString()}/<0;1>/*))#uv2ekg38`,
      },
      {
        isSorted: true,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2wsh',
        descriptor: `wsh(sortedmulti(2,${sortedTpub1.toString()}/<0;1>/*,${sortedTpub2.toString()}/<0;1>/*,${sortedTpub3.toString()}/<0;1>/*))#zxy26z43`,
      },
    ] as const

    for (const fixture of fixtures) {
      const acc = new MultiSigAccount(fixture.scriptType, fixture.threshold, fixture.isSorted, fixture.xpubs)
      expect(acc.descriptor()).toEqual(fixture.descriptor)
    }
  })

  test('address', () => {
    const threshold = 2
    const xpubs = [xpub3, xpub2, xpub1]
    const tpubs = [tpub3, tpub2, tpub1]

    // Fixtures copied from Sparrow wallet
    const fixtures = [
      {
        isSorted: false,
        threshold,
        xpubs,
        scriptType: 'p2sh',
        address: '34qsaG2bWeS332DdaiktYmtgmYLpR9yCPp',
      },
      {
        isSorted: true,
        threshold,
        xpubs,
        scriptType: 'p2sh',
        address: '3B4PQYaMQ5kB4jXiaLedKm2AWenPNGPVVG',
      },
      {
        isSorted: false,
        threshold,
        xpubs,
        scriptType: 'p2sh-p2wsh',
        address: '3BzHcjFFVFJ9KjhUaYLCtYx1KJSygoSzw8',
      },
      {
        isSorted: true,
        threshold,
        xpubs,
        scriptType: 'p2sh-p2wsh',
        address: '38mo48iE8ZyrDDtdS4WxrH78wKAGQEhm6k',
      },
      {
        isSorted: false,
        threshold,
        xpubs,
        scriptType: 'p2wsh',
        address: 'bc1qtupl2eusmdn8huuphgl670fxnnwuh40ef6g4a9w2jdhgeymw6y3sg6ta4m',
      },
      {
        isSorted: true,
        threshold,
        xpubs,
        scriptType: 'p2wsh',
        address: 'bc1qwqr9lapfu43wtpglrx6ujqhct326vmaxwjwxjdltzel59d6gzqjq5y7jvg',
      },
      {
        isSorted: false,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2sh',
        address: '2NEq4oX6BYy1naGtvV6zJ5SyxRpBFxoc2bo',
      },
      {
        isSorted: true,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2sh',
        address: '2MtYVmTssniGCF7wf7tezuFLRdtihNuKQrJ',
      },
      {
        isSorted: false,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2sh-p2wsh',
        address: '2NBeV8vee3U8yG9qqL1LTtxKcn1CeSudYAh',
      },
      {
        isSorted: true,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2sh-p2wsh',
        address: '2N2fWi4s9hziqhWusYCLYPsFd9LY9rSoTJU',
      },
      {
        isSorted: false,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2wsh',
        address: 'tb1qfszs908e7jvpmtzw05ar8usy3dd4z66s40d089n9nuh2slsyxs9qj7csqj',
      },
      {
        isSorted: true,
        threshold,
        xpubs: tpubs,
        scriptType: 'p2wsh',
        address: 'tb1q78zjaq4tjydrq6a89vqhld7f7r4y7csgn3h24r0vquw90398wjzqnq2h86',
      },
    ] as const

    for (const fixture of fixtures) {
      const acc = new MultiSigAccount(fixture.scriptType, fixture.threshold, fixture.isSorted, fixture.xpubs)
      expect(acc.address(0, 0).toString()).toEqual(fixture.address)
    }
  })

  it('should not allow mismatched networks', () => {
    const error = MultiSigAccount.from({
      isSorted: true,
      scriptType: 'p2wsh',
      threshold: 1,
      xpubs: [XPUB, TPUB],
    }).expectErr('invalid multisig account')
    expect(error.message).toContain('all xpubs must be from the same network, got: Mainnet, Testnet')
  })
})

describe('private keys in descriptors', () => {
  // BIP32 test vectors 1 (m, m/0H) and 2 (m/0): published vectors, not real wallets.
  const xprv =
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'
  const cosignerXprv =
    'xprv9uHRZZhk6KAJC1avXpDAp4MDc3sQKNxDiPvvkX8Br5ngLNv1TxvUxt4cV1rGL5hj6KCesnDYUhd7oWgT11eZG7XnxHrnYeSvkzY7d2bhkJ7'
  const cosignerXpub =
    'xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH'

  it.each([`wpkh(${xprv}/0/*)`, `wpkh([3442193e/84h/0h/0h]${xprv}/0/*)`])('rejects a single-sig %s', (descriptor) => {
    expect(SingleSigAccount.fromDescriptor(descriptor).isErr()).toBe(true)
  })

  it('rejects a multisig with a private cosigner key', () => {
    const descriptor = `wsh(sortedmulti(2,[3442193e/0h]${cosignerXprv}/<0;1>/*,[bd16bee5/0]${cosignerXpub}/<0;1>/*))`
    expect(MultiSigAccount.fromDescriptor(descriptor).isErr()).toBe(true)
  })
})
