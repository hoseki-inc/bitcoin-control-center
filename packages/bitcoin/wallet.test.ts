import { describe, expect, it, test } from 'vitest'
import { DerivationPath } from './derivation-path'
import * as descriptors from './descriptor_utils'
import { KeyFingerprint } from './key-expression'
import { KeyExpression, KeyOrigin } from './key-expression'
import { Network } from './network'
import { Wallet } from './wallet'
import { Xpub } from './xpub'

/**
 * Used for descriptors that we could not get a checksum from another source
 */
function withChecksum(str: string) {
  return descriptors.checksum(str).expect('valid checksum')
}

const TEST_XPUB_STR =
  'xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr'

const TPUB_STR =
  'tpubDD79jZKTZMENaFCfsbnRp3vS3jL4qbrQXUXc8egs34ixe8ovvkUBRx9U1YHkk3aiQfGzLijUEVkjCBSDPT2DxN4NWKzZT9cT3RGkBm7NzcA'
// const TPUB = Xpub.fromString(TPUB_STR).expect('valid tpub')

describe('Wallet', () => {
  describe('Singlesig', () => {
    test('fromDescriptor()', () => {
      const fixtures = [
        // Receive descriptors
        {
          id: 0,
          descriptor: `pkh(${TEST_XPUB_STR}/0/*)`,
          scriptType: 'p2pkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 1,
          descriptor: `sh(wpkh(${TEST_XPUB_STR}/0/*))`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 2,
          descriptor: `wpkh(${TEST_XPUB_STR}/0/*)`,
          scriptType: 'p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 3,
          descriptor: `tr(${TEST_XPUB_STR}/0/*)`,
          scriptType: 'p2tr',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 4,
          descriptor: `pkh(${TPUB_STR}/0/*)`,
          scriptType: 'p2pkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 5,
          descriptor: `sh(wpkh(${TPUB_STR}/0/*))`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 6,
          descriptor: `wpkh(${TPUB_STR}/0/*)`,
          scriptType: 'p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 7,
          descriptor: `tr(${TPUB_STR}/0/*)`,
          scriptType: 'p2tr',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        // Receive descriptors with checksum
        {
          id: 8,
          descriptor: `pkh(${TEST_XPUB_STR}/0/*)#qyxa220x`,
          scriptType: 'p2pkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 9,
          descriptor: `sh(wpkh(${TEST_XPUB_STR}/0/*))#kjap4hlt`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 10,
          descriptor: `wpkh(${TEST_XPUB_STR}/0/*)#kx6m7vwr`,
          scriptType: 'p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 11,
          descriptor: `tr(${TEST_XPUB_STR}/0/*)#ll8atqa2`,
          scriptType: 'p2tr',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 12,
          descriptor: withChecksum(`pkh(${TPUB_STR}/0/*)`),
          scriptType: 'p2pkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 13,
          descriptor: withChecksum(`sh(wpkh(${TPUB_STR}/0/*))`),
          scriptType: 'p2sh-p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 14,
          descriptor: withChecksum(`wpkh(${TPUB_STR}/0/*)`),
          scriptType: 'p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 15,
          descriptor: withChecksum(`tr(${TPUB_STR}/0/*)`),
          scriptType: 'p2tr',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        // Receive descriptors with origin
        {
          id: 16,
          descriptor: `pkh([00000000/44h/0h/0h]${TEST_XPUB_STR}/0/*)`,
          scriptType: 'p2pkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 44, hardened: true },
            { index: 0, hardened: true },
            { index: 0, hardened: true },
          ]),
        },
        {
          id: 17,
          descriptor: `sh(wpkh([00000000/49/0/0]${TEST_XPUB_STR}/0/*))`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 49, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 18,
          descriptor: `wpkh([00000000/84h/0h/0h]${TEST_XPUB_STR}/0/*)`,
          scriptType: 'p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: true },
            { index: 0, hardened: true },
            { index: 0, hardened: true },
          ]),
        },
        {
          id: 19,
          descriptor: `tr([00000000/84/0/0]${TEST_XPUB_STR}/0/*)`,
          scriptType: 'p2tr',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 20,
          descriptor: `pkh([00000000/44h/1h/0h]${TPUB_STR}/0/*)`,
          scriptType: 'p2pkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 44, hardened: true },
            { index: 1, hardened: true },
            { index: 0, hardened: true },
          ]),
        },
        {
          id: 21,
          descriptor: `sh(wpkh([00000000/49/1/0]${TPUB_STR}/0/*))`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 49, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 22,
          descriptor: `wpkh([00000000/84h/1h/0h]${TPUB_STR}/0/*)`,
          scriptType: 'p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: true },
            { index: 1, hardened: true },
            { index: 0, hardened: true },
          ]),
        },
        {
          id: 23,
          descriptor: `tr([00000000/84/1/0]${TPUB_STR}/0/*)`,
          scriptType: 'p2tr',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        // Receive descriptors with origin and checksum
        {
          id: 24,
          descriptor: `pkh([00000000/44/0/0]${TEST_XPUB_STR}/0/*)#r0t24mzg`,
          scriptType: 'p2pkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 44, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 25,
          descriptor: `sh(wpkh([00000000/49/0/0]${TEST_XPUB_STR}/0/*))#2ysgdd94`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 49, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 26,
          descriptor: `wpkh([00000000/84/0/0]${TEST_XPUB_STR}/0/*)#8cjjnqtq`,
          scriptType: 'p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 27,
          descriptor: `tr([00000000/84/0/0]${TEST_XPUB_STR}/0/*)#f3meyk9v`,
          scriptType: 'p2tr',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 28,
          descriptor: withChecksum(`pkh([00000000/44/1/0]${TPUB_STR}/0/*)`),
          scriptType: 'p2pkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 44, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 29,
          descriptor: withChecksum(`sh(wpkh([00000000/49/1/0]${TPUB_STR}/0/*))`),
          scriptType: 'p2sh-p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 49, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 30,
          descriptor: withChecksum(`wpkh([00000000/84/1/0]${TPUB_STR}/0/*)`),
          scriptType: 'p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 31,
          descriptor: withChecksum(`tr([00000000/84/1/0]${TPUB_STR}/0/*)`),
          scriptType: 'p2tr',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        // Address range descriptors
        {
          id: 32,
          descriptor: `pkh(${TEST_XPUB_STR}/<0;1>/*)`,
          scriptType: 'p2pkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 33,
          descriptor: `sh(wpkh(${TEST_XPUB_STR}/<0;1>/*))`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 34,
          descriptor: `wpkh(${TEST_XPUB_STR}/<0;1>/*)`,
          scriptType: 'p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 35,
          descriptor: `tr(${TEST_XPUB_STR}/<0;1>/*)`,
          scriptType: 'p2tr',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 36,
          descriptor: `pkh(${TPUB_STR}/<0;1>/*)`,
          scriptType: 'p2pkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 37,
          descriptor: `sh(wpkh(${TPUB_STR}/<0;1>/*))`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 38,
          descriptor: `wpkh(${TPUB_STR}/<0;1>/*)`,
          scriptType: 'p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 39,
          descriptor: `tr(${TPUB_STR}/<0;1>/*)`,
          scriptType: 'p2tr',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: null,
          derivationPath: null,
        },

        // Address range descriptors with checksum
        {
          id: 40,
          descriptor: `pkh(${TEST_XPUB_STR}/<0;1>/*)#kdnywuy7`,
          scriptType: 'p2pkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 41,
          descriptor: `sh(wpkh(${TEST_XPUB_STR}/<0;1>/*))#una0ueqx`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 42,
          descriptor: `wpkh(${TEST_XPUB_STR}/<0;1>/*)#l3xcgp8q`,
          scriptType: 'p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        {
          id: 43,
          descriptor: `tr(${TEST_XPUB_STR}/<0;1>/*)#40y9k7ac`,
          scriptType: 'p2tr',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: null,
          derivationPath: null,
        },
        // Address range descriptors with origin
        {
          id: 44,
          descriptor: `pkh([00000000/44/0/0]${TEST_XPUB_STR}/<0;1>/*)`,
          scriptType: 'p2pkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 44, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 45,
          descriptor: `sh(wpkh([00000000/49h/0h/0h]${TEST_XPUB_STR}/<0;1>/*))`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 49, hardened: true },
            { index: 0, hardened: true },
            { index: 0, hardened: true },
          ]),
        },
        {
          id: 46,
          descriptor: `wpkh([00000000/84/0/0]${TEST_XPUB_STR}/<0;1>/*)`,
          scriptType: 'p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 47,
          descriptor: `tr([00000000/84h/0h/0h]${TEST_XPUB_STR}/<0;1>/*)`,
          scriptType: 'p2tr',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: true },
            { index: 0, hardened: true },
            { index: 0, hardened: true },
          ]),
        },
        {
          id: 48,
          descriptor: `pkh([00000000/44/1/0]${TPUB_STR}/<0;1>/*)`,
          scriptType: 'p2pkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 44, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 49,
          descriptor: `sh(wpkh([00000000/49h/1h/0h]${TPUB_STR}/<0;1>/*))`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 49, hardened: true },
            { index: 1, hardened: true },
            { index: 0, hardened: true },
          ]),
        },
        {
          id: 50,
          descriptor: `wpkh([00000000/84/1/0]${TPUB_STR}/<0;1>/*)`,
          scriptType: 'p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 51,
          descriptor: `tr([00000000/84h/1h/0h]${TPUB_STR}/<0;1>/*)`,
          scriptType: 'p2tr',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: true },
            { index: 1, hardened: true },
            { index: 0, hardened: true },
          ]),
        },
        // Address range descriptors with origin and checksum
        {
          id: 52,
          descriptor: `pkh([00000000/44/0/0]${TEST_XPUB_STR}/<0;1>/*)#gtaj3740`,
          scriptType: 'p2pkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 44, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 53,
          descriptor: `sh(wpkh([00000000/49/0/0]${TEST_XPUB_STR}/<0;1>/*))#vussad4p`,
          scriptType: 'p2sh-p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 49, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 54,
          descriptor: `wpkh([00000000/84/0/0]${TEST_XPUB_STR}/<0;1>/*)#h3yr02t6`,
          scriptType: 'p2wpkh',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 55,
          descriptor: `tr([00000000/84/0/0]${TEST_XPUB_STR}/<0;1>/*)#ztcz8ru6`,
          scriptType: 'p2tr',
          xpub: TEST_XPUB_STR,
          network: Network.Mainnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 0, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 56,
          descriptor: withChecksum(`pkh([00000000/44/1/0]${TPUB_STR}/<0;1>/*)`),
          scriptType: 'p2pkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 44, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 57,
          descriptor: withChecksum(`sh(wpkh([00000000/49/1/0]${TPUB_STR}/<0;1>/*))`),
          scriptType: 'p2sh-p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 49, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 58,
          descriptor: withChecksum(`wpkh([00000000/84/1/0]${TPUB_STR}/<0;1>/*)`),
          scriptType: 'p2wpkh',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
        {
          id: 59,
          descriptor: withChecksum(`tr([00000000/84/1/0]${TPUB_STR}/<0;1>/*)`),
          scriptType: 'p2tr',
          xpub: TPUB_STR,
          network: Network.Testnet,
          fingerprint: KeyFingerprint.DEFAULT,
          derivationPath: new DerivationPath([
            { index: 84, hardened: false },
            { index: 1, hardened: false },
            { index: 0, hardened: false },
          ]),
        },
      ]

      for (const fixture of fixtures) {
        const acc = Wallet.Singlesig.fromDescriptor(fixture.descriptor).expect('valid account')
        expect(
          {
            // Keep ID here for easy debugging if the test fails
            id: fixture.id,
            scriptType: acc.scriptType,
            xpub: acc.keyExpression.xpub.toString(),
            network: acc.keyExpression.xpub.network,
            fingerprint: acc.keyExpression.keyOrigin?.fingerprint ?? null,
            derivationPath: acc.keyExpression.keyOrigin?.derivationPath ?? null,
          },
          fixture.descriptor,
        ).toEqual({
          id: fixture.id,
          scriptType: fixture.scriptType,
          xpub: fixture.xpub,
          network: fixture.network,
          fingerprint: fixture.fingerprint,
          derivationPath: fixture.derivationPath,
        })
      }
    })
  })

  describe('Multisig', () => {
    describe('fromDescriptor()', () => {
      it('returns with nested segwit script with valid checksum', async () => {
        const fingerprint = KeyFingerprint.DEFAULT
        const derivationPath = new DerivationPath([
          { index: 49, hardened: false },
          { index: 0, hardened: false },
          { index: 0, hardened: false },
        ])
        const origin = KeyOrigin.from(fingerprint, derivationPath)

        const xpub1 = Xpub.fromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const keyExpression1 = KeyExpression.from(xpub1, origin)

        const xpub2 = Xpub.fromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const keyExpression2 = KeyExpression.from(xpub2, origin)

        const xpub3 = Xpub.fromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')
        const keyExpression3 = KeyExpression.from(xpub3, origin)

        const nestedSegwitDescriptorWithChecksum = `sh(wsh(sortedmulti(2,${keyExpression1.toString()}/<0;1>/*,${keyExpression2.toString()}/<0;1>/*,${keyExpression3.toString()}/<0;1>/*)))#mkl9ckkl`
        const expected = Wallet.Multisig.from({
          scriptType: 'p2sh-p2wsh',
          threshold: 2,
          isSorted: true,
          keyExpressions: [keyExpression1, keyExpression2, keyExpression3],
        })

        const result = Wallet.Multisig.fromDescriptor(nestedSegwitDescriptorWithChecksum)

        expect(result.expect('valid account')).toStrictEqual(expected.expect('valid account'))
      })

      it('returns with segwit and sorted script', async () => {
        const fingerprint = KeyFingerprint.DEFAULT
        const derivationPath = new DerivationPath([
          { index: 49, hardened: false },
          { index: 0, hardened: false },
          { index: 0, hardened: false },
        ])
        const origin = KeyOrigin.from(fingerprint, derivationPath)

        const xpub1 = Xpub.fromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const keyExpression1 = KeyExpression.from(xpub1, origin)

        const xpub2 = Xpub.fromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const keyExpression2 = KeyExpression.from(xpub2, origin)

        const xpub3 = Xpub.fromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')
        const keyExpression3 = KeyExpression.from(xpub3, origin)

        const nativeSegwitDescriptorWithoutChecksum = `wsh(sortedmulti(2,${keyExpression1.toString()}/<0;1>/*,${keyExpression2.toString()}/<0;1>/*,${keyExpression3.toString()}/<0;1>/*))`
        const expected = Wallet.Multisig.from({
          scriptType: 'p2wsh',
          threshold: 2,
          isSorted: true,
          keyExpressions: [keyExpression1, keyExpression2, keyExpression3],
        })

        const result = Wallet.Multisig.fromDescriptor(nativeSegwitDescriptorWithoutChecksum)

        expect(result.expect('valid account')).toStrictEqual(expected.expect('valid account'))
      })

      it('returns with legacy and sorted script', async () => {
        const xpub1 = Xpub.fromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const keyExpression1 = KeyExpression.from(xpub1, null)

        const xpub2 = Xpub.fromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const keyExpression2 = KeyExpression.from(xpub2, null)

        const xpub3 = Xpub.fromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')
        const keyExpression3 = KeyExpression.from(xpub3, null)

        const legacyDescriptorWithoutChecksum = `sh(sortedmulti(2,${keyExpression1.toString()}/<0;1>/*,${keyExpression2.toString()}/<0;1>/*,${keyExpression3.toString()}/<0;1>/*))`
        const expected = Wallet.Multisig.from({
          scriptType: 'p2sh',
          threshold: 2,
          isSorted: true,
          keyExpressions: [keyExpression1, keyExpression2, keyExpression3],
        })

        const result = Wallet.Multisig.fromDescriptor(legacyDescriptorWithoutChecksum)

        expect(result.expect('valid account')).toStrictEqual(expected.expect('valid account'))
      })

      it('returns with not sorted script and with threshold=2, xpubs.length=3', async () => {
        const fingerprint = KeyFingerprint.DEFAULT
        const derivationPath = new DerivationPath([
          { index: 49, hardened: false },
          { index: 0, hardened: false },
          { index: 0, hardened: false },
        ])
        const origin = KeyOrigin.from(fingerprint, derivationPath)

        const xpub1 = Xpub.fromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const keyExpression1 = KeyExpression.from(xpub1, origin)

        const xpub2 = Xpub.fromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const keyExpression2 = KeyExpression.from(xpub2, origin)

        const xpub3 = Xpub.fromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')
        const keyExpression3 = KeyExpression.from(xpub3, origin)

        const notSortedDescriptorWithoutChecksum = `sh(wsh(multi(2,${keyExpression1.toString()}/<0;1>/*,${keyExpression2.toString()}/<0;1>/*,${keyExpression3.toString()}/<0;1>/*)))`
        const expected = Wallet.Multisig.from({
          scriptType: 'p2sh-p2wsh',
          threshold: 2,
          isSorted: false,
          keyExpressions: [keyExpression1, keyExpression2, keyExpression3],
        })

        const result = Wallet.Multisig.fromDescriptor(notSortedDescriptorWithoutChecksum)

        expect(result.expect('valid account')).toStrictEqual(expected.expect('valid account'))
      })

      it('accept keystores with no origin bracket', async () => {
        const xpub1 = Xpub.fromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const keyExpression1 = KeyExpression.from(xpub1, null)

        const xpub2 = Xpub.fromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const keyExpression2 = KeyExpression.from(xpub2, null)

        const xpub3 = Xpub.fromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')
        const keyExpression3 = KeyExpression.from(xpub3, null)

        const descriptorWithNoOriginInKeystores = `sh(wsh(multi(2,${xpub1.toString()}/<0;1>/*,${xpub2.toString()}/<0;1>/*,${xpub3.toString()}/<0;1>/*)))`
        const expected = Wallet.Multisig.from({
          scriptType: 'p2sh-p2wsh',
          threshold: 2,
          isSorted: false,
          keyExpressions: [keyExpression1, keyExpression2, keyExpression3],
        })

        const result = Wallet.Multisig.fromDescriptor(descriptorWithNoOriginInKeystores)

        expect(result.expect('valid account')).toStrictEqual(expected.expect('valid account'))
      })

      /**
       * failure paths
       */

      it('fails with not allowed script type factors', async () => {
        const descriptorsWithInvalidScriptTypeFactors = [
          'tr(wsh(multi(2,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*)))',
          'sh(tr(multi(2,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*)))',
          'wsh(sh(multi(2,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*)))',
          'sh(sh(multi(2,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*)))',
          'wsh(wsh(multi(2,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*)))',
        ] as const
        const result = Wallet.Multisig.fromDescriptor(descriptorsWithInvalidScriptTypeFactors[0])
        const result2 = Wallet.Multisig.fromDescriptor(descriptorsWithInvalidScriptTypeFactors[1])
        const result3 = Wallet.Multisig.fromDescriptor(descriptorsWithInvalidScriptTypeFactors[2])
        const result4 = Wallet.Multisig.fromDescriptor(descriptorsWithInvalidScriptTypeFactors[3])
        const result5 = Wallet.Multisig.fromDescriptor(descriptorsWithInvalidScriptTypeFactors[4])

        expect(result.isOk()).toBe(false)
        expect(result2.isOk()).toBe(false)
        expect(result3.isOk()).toBe(false)
        expect(result4.isOk()).toBe(false)
        expect(result5.isOk()).toBe(false)
      })

      it('fails with not allowed sort script types', async () => {
        const descriptorWithInvalidSortType =
          'wsh(INVALID(2,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*))'
        const result = Wallet.Multisig.fromDescriptor(descriptorWithInvalidSortType)
        expect(result.isOk()).toBe(false)
      })

      it('fails when k (number of required keys) is invalid', async () => {
        const descriptorWithInvalidNumberOfRequiredKeys = [
          'wsh(multi(4,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*))',
          'wsh(multi(0,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*))',
          'wsh(multi(a,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*))',
        ] as const
        const result = Wallet.Multisig.fromDescriptor(descriptorWithInvalidNumberOfRequiredKeys[0])
        const result2 = Wallet.Multisig.fromDescriptor(descriptorWithInvalidNumberOfRequiredKeys[1])
        const result3 = Wallet.Multisig.fromDescriptor(descriptorWithInvalidNumberOfRequiredKeys[2])

        expect(result.isOk()).toBe(false)
        expect(result2.isOk()).toBe(false)
        expect(result3.isOk()).toBe(false)
      })

      it('fails fingerprint format is invalid', async () => {
        const descriptorWithInvalidFingerprint =
          'wsh(multi(2,[Z0000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*))'
        const result = Wallet.Multisig.fromDescriptor(descriptorWithInvalidFingerprint)
        expect(result.isOk()).toBe(false)
      })

      it('fails derivation path is invalid', async () => {
        const descriptorsWithInvalidDerivationPath = [
          'wsh(multi(2,[00000000/49/a0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*))',
          'wsh(multi(2,[00000000/t/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*))',
        ] as const
        const result = Wallet.Multisig.fromDescriptor(descriptorsWithInvalidDerivationPath[0])
        const result2 = Wallet.Multisig.fromDescriptor(descriptorsWithInvalidDerivationPath[1])

        expect(result.isOk()).toBe(false)
        expect(result2.isOk()).toBe(false)
      })

      it('fails when one ore more keys are not xpubs', async () => {
        const descriptorWithoutXpubKeys =
          'wsh(multi(2,ypub03a0434d9e47f3c86235477c7b1ae6ae5d3442d49b1943c2b752a68e2a47e247c7,zpub03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb,03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a))'
        const result = Wallet.Multisig.fromDescriptor(descriptorWithoutXpubKeys)
        expect(result.isOk()).toBe(false)
      })
    })
  })
})
