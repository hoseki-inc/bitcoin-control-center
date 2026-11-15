import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bip32, bitcoin, bs58check } from '../bitcoin/lib'
import { getXpubFromString } from './slip-132'

// Users paste keys in any SLIP-132 format, and the browser converts them to xpub/tpub before
// building a descriptor. Every public format must convert to the same key; no private format may.

// SLIP-132 version bytes, by network: public then private.
const versions = {
  mainnet: {
    network: bitcoin.networks.bitcoin,
    public: { x: '0488b21e', y: '049d7cb2', Y: '0295b43f', z: '04b24746', Z: '02aa7ed3' },
    private: { x: '0488ade4', y: '049d7878', Y: '0295b005', z: '04b2430c', Z: '02aa7a99' },
  },
  testnet: {
    network: bitcoin.networks.testnet,
    public: { t: '043587cf', u: '044a5262', U: '024289ef', v: '045f1cf6', V: '02575483' },
    private: { t: '04358394', u: '044a4e28', U: '024285b5', v: '045f18bc', V: '02575048' },
  },
}

function withVersion(key: string, version: string): string {
  return bs58check.encode(Buffer.concat([Buffer.from(version, 'hex'), bs58check.decode(key).subarray(4)]))
}

const keyArbitrary = fc.record({
  seed: fc.uint8Array({ minLength: 16, maxLength: 64 }),
  path: fc.array(fc.integer({ min: 0, max: 2 ** 31 - 1 }), { maxLength: 4 }),
  network: fc.constantFrom<keyof typeof versions>('mainnet', 'testnet'),
})

describe('SLIP-132 keys', () => {
  it('convert to the same core key from every public format, and never from a private one', () => {
    fc.assert(
      fc.property(keyArbitrary, ({ seed, path, network }) => {
        const { network: bitcoinNetwork, public: publicVersions, private: privateVersions } = versions[network]
        const node = path.reduce(
          (parent, index) => parent.deriveHardened(index),
          bip32.fromSeed(Buffer.from(seed), bitcoinNetwork),
        )
        const core = node.neutered().toBase58()

        for (const [prefix, version] of Object.entries(publicVersions)) {
          const key = withVersion(core, version)
          expect(key.startsWith(`${prefix}pub`), key).toBe(true)
          expect(getXpubFromString(key).expect(key).toString()).toBe(core)
        }
        for (const [prefix, version] of Object.entries(privateVersions)) {
          const key = withVersion(node.toBase58(), version)
          expect(key.startsWith(`${prefix}prv`), key).toBe(true)
          expect(getXpubFromString(key).isErr(), key).toBe(true)
        }
      }),
    )
  }, 60_000)
})
