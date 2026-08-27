import { describe, expect, it } from 'vitest'
import { parseWalletExport } from './wallet-export-parser'

describe('parseWalletExport', () => {
  it('should fail on invalid json', () => {
    const wallet = parseWalletExport(JSON.stringify({ foo: 'bar' }), 'application/json')
    expect(wallet.isOk()).toBe(false)
  })

  it('should fail on fileType mis-match', () => {
    const wallet = parseWalletExport(JSON.stringify({ foo: 'bar' }), 'application/json')
    expect(wallet.isOk()).toBe(false)
  })

  it('should parse an Electrum wallet export', () => {
    const electrumWallet = {
      'x1/': {
        xpub: 'Ypub6kpmvVnFJBvruyJckrLUP2R5sVUi6CEqUV83AtTSQgtYRgFiZbhjdVycEwqxJaM22oQiFfQ4FytmZFzFRuYDrtT3Q2FS5vMDVBANwjpHPME',
        hw_type: 'ledger',
        root_fingerprint: '016e9edf',
        label: 'Ledger Nano S Plus',
        type: 'hardware',
        derivation: "m/48'/0'/0'/1'",
      },
      'x2/': {
        xpub: 'Ypub6jZBQi3G8p9TfK5E7TkzdDszf67UAHNYmfYmB9Y3RjnKZ5F5CoWGUnJhVDZNiP6G5HePPrdNv7tZ4KfWbKwELY5d6fAPMMuLX6XZg6duRaY',
        hw_type: 'trezor',
        root_fingerprint: 'ac16c6a4',
        label: 'Trezor One',
        type: 'hardware',
        derivation: "m/48'/0'/0'/1'",
      },
      wallet_type: '2of2',
      use_encryption: false,
    }

    const walletResult = parseWalletExport(JSON.stringify(electrumWallet), 'application/json')
    expect(walletResult.isOk()).toBe(true)

    const parsed = walletResult.unwrap()!
    expect(parsed.walletType).toBe('Electrum')
    expect(parsed.wallet.scriptType).toBe('p2sh-p2wsh')
    expect(parsed.wallet.threshold).toBe(2)
    expect(parsed.keystoreMetadata).toHaveLength(2)

    // Check keystore labels and metadata - Electrum uses the actual hardware wallet labels
    const keystoreLabels = parsed.keystoreMetadata.map((ks) => ks.label).sort()
    expect(keystoreLabels).toEqual(['Ledger Nano S Plus', 'Trezor One'])

    // Check derivation paths
    parsed.wallet.keyExpressions.forEach((ke) => {
      expect(ke.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/1h')
    })

    // Check metadata - Electrum stores hardware wallet types
    const hardwareTypes = parsed.keystoreMetadata.map((ks) => ks.walletType).sort()
    expect(hardwareTypes).toEqual(['ledger', 'trezor'])
  })

  it('should parse a SpecterDesktop wallet export - where account range is present', () => {
    const specterWallet = {
      label: 'Multi Nested SegWit',
      blockheight: 910623,
      descriptor:
        // The /<0;1>/* account range is present in the descriptor
        'sh(wsh(sortedmulti(2,[016e9edf/48h/0h/0h/1h]xpub6F6RVbNtaYq1e6x7yq5sLrymyjHzwDZkF6x9UEJ1eugFkPsaYY9tvKTYR2vtkEUCPhDvdboNv79iYokvQyyFvAemhDSc6c4jKipryDCN6rh/<0;1>/*,[ac16c6a4/48h/0h/0h/1h]xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu/<0;1>/*)))',
    }

    const walletResult = parseWalletExport(JSON.stringify(specterWallet), 'application/json')
    expect(walletResult.isOk()).toBe(true)

    const parsed = walletResult.unwrap()!
    expect(parsed.label).toBe('Multi Nested SegWit')
    expect(parsed.walletType).toBe('Specter Desktop')
    expect(parsed.wallet.scriptType).toBe('p2sh-p2wsh')
    expect(parsed.wallet.threshold).toBe(2)
    expect(parsed.keystoreMetadata).toHaveLength(2)

    // Check keystore labels and metadata - Specter Desktop uses generic numbered labels
    const keystoreLabels = parsed.keystoreMetadata.map((ks) => ks.label).sort()
    expect(keystoreLabels).toEqual(['Keystore 1', 'Keystore 2'])

    // Check derivation paths
    parsed.wallet.keyExpressions.forEach((ke) => {
      expect(ke.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/1h')
    })
  })

  it('should parse a SpecterDesktop wallet export - where account range is missing', () => {
    const specterWallet = {
      label: 'Multi Nested SegWit',
      blockheight: 910623,
      descriptor:
        // The /<0;1>/* account range is missing in the descriptor (Alex's Sparrow exports it this way)
        'sh(wsh(sortedmulti(2,[016e9edf/48h/0h/0h/1h]xpub6F6RVbNtaYq1e6x7yq5sLrymyjHzwDZkF6x9UEJ1eugFkPsaYY9tvKTYR2vtkEUCPhDvdboNv79iYokvQyyFvAemhDSc6c4jKipryDCN6rh,[ac16c6a4/48h/0h/0h/1h]xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu)))#e8w5dgqw',
    }

    const walletResult = parseWalletExport(JSON.stringify(specterWallet), 'application/json')
    expect(walletResult.isOk()).toBe(true)

    const parsed = walletResult.unwrap()!
    expect(parsed.label).toBe('Multi Nested SegWit')
    expect(parsed.walletType).toBe('Specter Desktop')
    expect(parsed.wallet.scriptType).toBe('p2sh-p2wsh')
    expect(parsed.wallet.threshold).toBe(2)
    expect(parsed.keystoreMetadata).toHaveLength(2)

    // Check keystore labels and metadata - Specter Desktop uses generic numbered labels
    const keystoreLabels = parsed.keystoreMetadata.map((ks) => ks.label).sort()
    expect(keystoreLabels).toEqual(['Keystore 1', 'Keystore 2'])

    // Check derivation paths
    parsed.wallet.keyExpressions.forEach((ke) => {
      expect(ke.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/1h')
    })
  })

  it('should parse an Unchained Caravan wallet export', () => {
    const caravanWallet = {
      name: 'Multi Nested SegWit',
      addressType: 'P2SH_P2WSH',
      network: 'mainnet',
      startingAddressIndex: 0,
      client: {
        type: 'public',
      },
      quorum: {
        requiredSigners: 2,
        totalSigners: 2,
      },
      extendedPublicKeys: [
        {
          name: 'Ledger Nano S Plus',
          bip32Path: "m/48'/0'/0'/1'",
          xpub: 'xpub6F6RVbNtaYq1e6x7yq5sLrymyjHzwDZkF6x9UEJ1eugFkPsaYY9tvKTYR2vtkEUCPhDvdboNv79iYokvQyyFvAemhDSc6c4jKipryDCN6rh',
          xfp: '016e9edf',
          method: 'ledger',
        },
        {
          name: 'Trezor One',
          bip32Path: "m/48'/0'/0'/1'",
          xpub: 'xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu',
          xfp: 'ac16c6a4',
          method: 'trezor',
        },
      ],
    }

    const walletResult = parseWalletExport(JSON.stringify(caravanWallet), 'application/json')
    expect(walletResult.isOk()).toBe(true)

    const parsed = walletResult.unwrap()!
    expect(parsed.label).toBe('Multi Nested SegWit')
    expect(parsed.walletType).toBe('Unchained Caravan')
    expect(parsed.wallet.scriptType).toBe('p2sh-p2wsh')
    expect(parsed.wallet.threshold).toBe(2)
    expect(parsed.keystoreMetadata).toHaveLength(2)

    // Check keystore labels and metadata - Unchained Caravan uses hardware wallet names
    const keystoreLabels = parsed.keystoreMetadata.map((ks) => ks.label).sort()
    expect(keystoreLabels).toEqual(['Ledger Nano S Plus', 'Trezor One'])

    // Check derivation paths
    parsed.wallet.keyExpressions.forEach((ke) => {
      expect(ke.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/1h')
    })

    // Check metadata - Unchained Caravan stores hardware wallet methods
    const hardwareMethods = parsed.keystoreMetadata.map((ks) => ks.walletType).sort()
    expect(hardwareMethods).toEqual(['ledger', 'trezor'])
  })

  it('should fail on invalid txt', () => {
    expect(parseWalletExport('', 'text/plain').isOk()).toBe(false)
    expect(
      parseWalletExport('bc1pl4hkmfadn7lqkvwqfn8ghpaguvvenya86fr5nkhszw9lmynq4jgq6ng7qu', 'text/plain').isOk(),
    ).toBe(false)
    expect(parseWalletExport(['line1', 'line2', 'line3'].join('\n'), 'text/plain').isOk()).toBe(false)
  })

  it('should parse a BitcoinCore-style wallet export', () => {
    const walletResult = parseWalletExport(
      [
        '# Receive and change descriptor (BIP389):',
        'sh(wsh(sortedmulti(2,[ac16c6a4/48h/0h/0h/1h]xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu/<0;1>/*,[016e9edf/48h/0h/0h/1h]xpub6F6RVbNtaYq1e6x7yq5sLrymyjHzwDZkF6x9UEJ1eugFkPsaYY9tvKTYR2vtkEUCPhDvdboNv79iYokvQyyFvAemhDSc6c4jKipryDCN6rh/<0;1>/*)))#35mrz67w',
        '',
        '',
        '# Receive descriptor (Bitcoin Core):',
        'sh(wsh(sortedmulti(2,[ac16c6a4/48h/0h/0h/1h]xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu/0/*,[016e9edf/48h/0h/0h/1h]xpub6F6RVbNtaYq1e6x7yq5sLrymyjHzwDZkF6x9UEJ1eugFkPsaYY9tvKTYR2vtkEUCPhDvdboNv79iYokvQyyFvAemhDSc6c4jKipryDCN6rh/0/*)))#4phfc0uk',
        '',
        '# Change descriptor (Bitcoin Core):',
        'sh(wsh(sortedmulti(2,[016e9edf/48h/0h/0h/1h]xpub6F6RVbNtaYq1e6x7yq5sLrymyjHzwDZkF6x9UEJ1eugFkPsaYY9tvKTYR2vtkEUCPhDvdboNv79iYokvQyyFvAemhDSc6c4jKipryDCN6rh/1/*,[ac16c6a4/48h/0h/0h/1h]xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu/1/*)))#fe7hpksr',
      ].join('\n'),
      'text/plain',
    )
    expect(walletResult.isOk()).toBe(true)

    const parsed = walletResult.unwrap()!
    expect(parsed.walletType).toBe('Bitcoin Core')
    expect(parsed.wallet.scriptType).toBe('p2sh-p2wsh')
    expect(parsed.wallet.threshold).toBe(2)
    expect(parsed.keystoreMetadata).toHaveLength(2)

    // Check keystores and metadata
    expect(parsed.keystoreMetadata[0]!.label).toEqual('Keystore 1')
    expect(parsed.wallet.keyExpressions[0]?.keyOrigin?.fingerprint).toBe('ac16c6a4')
    expect(parsed.wallet.keyExpressions[0]?.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/1h')

    expect(parsed.keystoreMetadata[1]!.label).toEqual('Keystore 2')
    expect(parsed.wallet.keyExpressions[1]?.keyOrigin?.fingerprint).toBe('016e9edf')
    expect(parsed.wallet.keyExpressions[1]?.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/1h')
  })

  it('should parse a Coldcard/BlueWallet-style wallet export', () => {
    // This is the file that came from a Sparrow export
    const walletResult = parseWalletExport(
      [
        '# Coldcard Multisig setup file (created by Sparrow)',
        '#',
        'Name: Multi Nested SegWit',
        'Policy: 2 of 2',
        "Derivation: m/48'/0'/0'/1'",
        'Format: P2WSH-P2SH',
        '',
        '016E9EDF: xpub6F6RVbNtaYq1e6x7yq5sLrymyjHzwDZkF6x9UEJ1eugFkPsaYY9tvKTYR2vtkEUCPhDvdboNv79iYokvQyyFvAemhDSc6c4jKipryDCN6rh',
        'AC16C6A4: xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu',
        '',
      ].join('\n'),
      'text/plain',
    )
    expect(walletResult.isOk()).toBe(true)

    const parsed = walletResult.unwrap()!
    expect(parsed.label).toBe('Multi Nested SegWit')
    expect(parsed.walletType).toBe('Coldcard')
    expect(parsed.wallet.scriptType).toBe('p2sh-p2wsh')
    expect(parsed.wallet.threshold).toBe(2)
    expect(parsed.keystoreMetadata).toHaveLength(2)

    // Check keystore labels and metadata - Coldcard format uses fingerprint labels
    const keystoreLabels = parsed.keystoreMetadata.map((ks) => ks.label).sort()
    expect(keystoreLabels).toEqual(['Keystore 1', 'Keystore 2'])

    parsed.wallet.keyExpressions.forEach((keystore) => {
      expect(keystore.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/1h')
    })
  })

  it('should parse the BlueWallet wallet export: "Export Coordination Setup"', () => {
    // This is the file that came from the BlueWallet mobile app
    const walletResult = parseWalletExport(
      [
        '# BlueWallet Multisig setup file',
        '# this file contains only public keys and is safe to',
        '# distribute among cosigners',
        '#',
        'Name: Alexs Blue Multi',
        'Policy: 2 of 3',
        "Derivation: m/48'/0'/0'/2'",
        'Format: P2WSH',
        '',
        '4B667D55: Zpub75MBfc96bjry3P4bf2yixrqZHNsNjttB4abK8h3wdnJWsWTFzuX727FzcZ9Gy1hMQmQL6avc9FhiHUsiphL6uw1ANh5yC8R9wRkCDjWcrpN',
        '',
        '41E78E37: Zpub75fGvFX9zTvZ85hARpERjb7Nvi9vkgFxoJc4weKkAATaUn9Jew7MFqK1h3x5Sb5t6GFqzeDpB3G9TJs5aEcFTCfkHAPxEZvsgxMpRsWn6x4',
        '',
        'F990D1FA: Zpub75UnhFysqrmn6N2gtmNDLjLfMbq6yGPko5wTfQwYUD58onNi5NgZJUYGZuFu9NEFAsoXB1xvSAyrKAKKmLMU7pCjDvauP9rWJGUNyLG3jS5',
        '',
      ].join('\n'),
      'text/plain',
    )
    expect(walletResult.isOk()).toBe(true)

    const parsed = walletResult.unwrap()!
    expect(parsed.label).toBe('Alexs Blue Multi')
    expect(parsed.walletType).toBe('BlueWallet')
    expect(parsed.wallet.scriptType).toBe('p2wsh')
    expect(parsed.wallet.threshold).toBe(2)
    expect(parsed.keystoreMetadata).toHaveLength(3)

    // Check keystore labels and metadata - BlueWallet format uses fingerprint labels
    const keystoreLabels = parsed.keystoreMetadata.map((ks) => ks.label).sort()
    expect(keystoreLabels).toEqual(['Keystore 1', 'Keystore 2', 'Keystore 3'])

    parsed.wallet.keyExpressions.forEach((keystore) => {
      expect(keystore.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/2h')
    })
  })

  it('should fail the BlueWallet wallet export: "Export/Backup" - if it contains a seed', () => {
    // This is the file that came from the BlueWallet mobile app
    const walletResult = parseWalletExport(
      [
        '# BlueWallet Multisig setup file',
        '# this file may contain private information',
        '#',
        'Name: Alexs Multisig Vault',
        'Policy: 2 of 3',
        "Derivation: m/48'/0'/0'/2'",
        'Format: P2WSH',
        '',
        'FD0CF684: Zpub75wimedE1uRGjpvmGUjuHA2yWcSoupYNPbf5VMLFCVyzdKBFUqRQs3JyirVTrouTPAtMnSbRhEt1UCzrkYkKeTig3QdZSKCuvXTkHwZHC9q',
        '',
        '822A0FD7: Zpub75ijfUG6KCTgFJq52gSCTsQQaqiGa7c24mdgSabxL5SuHcdWTpZp84Dp8GKsuo8SYrPHz5tB6Ab12MGQxbwtLJNHBEZGf9Cq1h3jsz2nWfL',
        '',
        // One of the keystores contains a seed, so we should reject this file - it is the wrong file.
        // The BlueWallet UI has a different button the user is supposed to click.
        'seed: one two three four five six seven eight nine ten eleven twelve',
        '# warning! sensitive information, do not disclose ^^^',
        '',
      ].join('\n'),
      'text/plain',
    )
    expect(walletResult.isOk()).toBe(false)
  })

  it('should fail to parse a Coldcard/BlueWallet-style wallet export with missing fields', () => {
    const walletResult = parseWalletExport(
      [
        '# Coldcard Multisig setup file (created by Sparrow)',
        '#',
        'Name: Multi Nested SegWit',
        'Policy: 2 of 2',
        //"Derivation: m/48'/0'/0'/1'", <-- missing
        'Format: P2WSH-P2SH',
        '',
        '016E9EDF: xpub6F6RVbNtaYq1e6x7yq5sLrymyjHzwDZkF6x9UEJ1eugFkPsaYY9tvKTYR2vtkEUCPhDvdboNv79iYokvQyyFvAemhDSc6c4jKipryDCN6rh',
        'AC16C6A4: xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu',
        '',
      ].join('\n'),
      'text/plain',
    )
    expect(walletResult.isOk()).toBe(false)
  })

  it('should parse a raw descriptor wallet export', () => {
    const walletResult = parseWalletExport(
      [
        'wsh(sortedmulti(2,[ac16c6a4/48h/0h/0h/2h]xpub6DppyoduRB3cRe68F7bsKSyZP7djEhPGESSqt3jwqcYsyCZEihVS1ykAqiVyGr8LC7PNfqZLaNRSgV9UiD7iXfmLi2EVrDSWaUmBdh5e6u4/<0;1>/*,[016e9edf/48h/0h/0h/2h]xpub6F6RVbNtaYq1ggd6mhXT35JVeGGs5CkxdUWxYRW9AQ52jGGn15R4mphVU8fovuKVcYMjqjPs4bdxYgcZsMbcU492JTq7KLQXSEosrfCnsr8/<0;1>/*))#4glz33xa',
        '',
      ].join('\n'),
      'text/plain',
    )
    expect(walletResult.isOk()).toBe(true)

    const parsed = walletResult.unwrap()!
    expect(parsed.wallet.scriptType).toBe('p2wsh')
    expect(parsed.wallet.threshold).toBe(2)
    expect(parsed.keystoreMetadata).toHaveLength(2)

    const keystoreLabels = parsed.keystoreMetadata.map((ks) => ks.label).sort()
    expect(keystoreLabels).toEqual(['Keystore 1', 'Keystore 2'])

    parsed.wallet.keyExpressions.forEach((keystore) => {
      expect(keystore.keyOrigin?.derivationPath?.toString()).toBe('m/48h/0h/0h/2h')
    })
  })
})
