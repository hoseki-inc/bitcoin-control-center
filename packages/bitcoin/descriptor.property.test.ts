import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MultiSigAccount, SingleSigAccount } from './account'
import { checksum } from './descriptor_utils'
import { type BIP32Interface, bip32, bitcoin, bs58check } from './lib'
import { containsExtendedPrivateKey } from './xpub'

// Generates descriptors in every shape Control Center accepts and checks the addresses it watches.
// The expected addresses come straight from the generated keys, never from parsing the descriptor,
// so a parser that reads the wrong key, order, threshold or script type fails here.

const networks = { mainnet: bitcoin.networks.bitcoin, testnet: bitcoin.networks.testnet }
type NetworkName = keyof typeof networks

interface Key {
  node: BIP32Interface
  /** The key as a descriptor writes it, with its origin when it has one, and no range. */
  publicKey: string
  privateKey: string
}

/** An account key from a random seed, with or without a key origin, as wallets export them. */
const keyArbitrary = (network: NetworkName): fc.Arbitrary<Key> =>
  fc
    .record({
      seed: fc.uint8Array({ minLength: 16, maxLength: 64 }),
      path: fc.array(fc.integer({ min: 0, max: 2 ** 31 - 1 }), { maxLength: 4 }),
      withOrigin: fc.boolean(),
    })
    .map(({ seed, path, withOrigin }) => {
      const master = bip32.fromSeed(Buffer.from(seed), networks[network])
      const node = path.reduce((parent, index) => parent.deriveHardened(index), master)
      const fingerprint = Buffer.from(master.fingerprint).toString('hex')
      const origin = withOrigin ? `[${[fingerprint, ...path.map((index) => `${index}h`)].join('/')}]` : ''
      return { node, publicKey: `${origin}${node.neutered().toBase58()}`, privateKey: `${origin}${node.toBase58()}` }
    })

const networkArbitrary = fc.constantFrom<NetworkName>('mainnet', 'testnet')
// Wallets export either one receive path or both receive and change paths.
const rangeArbitrary = fc.constantFrom('/<0;1>/*', '/0/*')

function changes(range: string): (0 | 1)[] {
  return range === '/0/*' ? [0] : [0, 1]
}

function withChecksum(descriptor: string, add: boolean): string {
  return add ? checksum(descriptor).expect('checksum') : descriptor
}

function childKey(key: Key, change: 0 | 1, index: number): Buffer {
  return Buffer.from(key.node.derive(change).derive(index).publicKey)
}

function addressOf(payment: bitcoin.Payment): string {
  const { address } = payment
  if (address === undefined) {
    throw new Error('payment has no address')
  }
  return address
}

const singlesigScripts = ['pkh', 'sh-wpkh', 'wpkh', 'tr'] as const
type SinglesigScript = (typeof singlesigScripts)[number]

function singlesigDescriptor(script: SinglesigScript, key: string): string {
  return { pkh: `pkh(${key})`, 'sh-wpkh': `sh(wpkh(${key}))`, wpkh: `wpkh(${key})`, tr: `tr(${key})` }[script]
}

function singlesigAddress(script: SinglesigScript, pubkey: Buffer, network: bitcoin.Network): string {
  switch (script) {
    case 'pkh':
      return addressOf(bitcoin.payments.p2pkh({ pubkey, network }))
    case 'sh-wpkh':
      return addressOf(bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network }), network }))
    case 'wpkh':
      return addressOf(bitcoin.payments.p2wpkh({ pubkey, network }))
    case 'tr':
      return addressOf(bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1, 33), network }))
  }
}

const multisigScripts = ['sh', 'sh-wsh', 'wsh'] as const
type MultisigScript = (typeof multisigScripts)[number]

function multisigDescriptor(script: MultisigScript, sorted: boolean, threshold: number, keys: string[]): string {
  const multi = `${sorted ? 'sortedmulti' : 'multi'}(${threshold},${keys.join(',')})`
  return { sh: `sh(${multi})`, 'sh-wsh': `sh(wsh(${multi}))`, wsh: `wsh(${multi})` }[script]
}

function multisigAddress(
  script: MultisigScript,
  threshold: number,
  pubkeys: Buffer[],
  network: bitcoin.Network,
): string {
  const redeem = bitcoin.payments.p2ms({ m: threshold, pubkeys, network })
  switch (script) {
    case 'sh':
      return addressOf(bitcoin.payments.p2sh({ redeem, network }))
    case 'sh-wsh':
      return addressOf(bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wsh({ redeem, network }), network }))
    case 'wsh':
      return addressOf(bitcoin.payments.p2wsh({ redeem, network }))
  }
}

const singlesigArbitrary = networkArbitrary.chain((network) =>
  fc.record({
    network: fc.constant(network),
    key: keyArbitrary(network),
    script: fc.constantFrom(...singlesigScripts),
    range: rangeArbitrary,
    checksummed: fc.boolean(),
    index: fc.integer({ min: 0, max: 1000 }),
  }),
)

const multisigArbitrary = networkArbitrary.chain((network) =>
  // Wallets refuse the same key twice, so the cosigners are distinct.
  fc
    .uniqueArray(keyArbitrary(network), {
      minLength: 1,
      maxLength: 5,
      selector: (key) => key.node.neutered().toBase58(),
    })
    .chain((keys) =>
      fc.record({
        network: fc.constant(network),
        keys: fc.constant(keys),
        threshold: fc.integer({ min: 1, max: keys.length }),
        script: fc.constantFrom(...multisigScripts),
        sorted: fc.boolean(),
        range: rangeArbitrary,
        checksummed: fc.boolean(),
        index: fc.integer({ min: 0, max: 1000 }),
      }),
    ),
)

describe('singlesig descriptors', () => {
  it('watch the addresses of their key, before and after saving', () => {
    fc.assert(
      fc.property(singlesigArbitrary, ({ network, key, script, range, checksummed, index }) => {
        const descriptor = withChecksum(singlesigDescriptor(script, `${key.publicKey}${range}`), checksummed)
        const account = SingleSigAccount.fromDescriptor(descriptor).expect(descriptor)
        const reloaded = SingleSigAccount.fromDescriptor(account.toString()).expect(account.toString())
        for (const change of changes(range)) {
          const expected = singlesigAddress(script, childKey(key, change, index), networks[network])
          expect(account.address(change, index).toString()).toBe(expected)
          expect(reloaded.address(change, index).toString()).toBe(expected)
        }
      }),
    )
    // Key derivation is slow, and other suites run alongside.
  }, 60_000)
})

describe('multisig descriptors', () => {
  it('watch the addresses of their keys, before and after saving', () => {
    fc.assert(
      fc.property(multisigArbitrary, ({ network, keys, script, sorted, threshold, range, checksummed, index }) => {
        const keyExpressions = keys.map((key) => `${key.publicKey}${range}`)
        const descriptor = withChecksum(multisigDescriptor(script, sorted, threshold, keyExpressions), checksummed)
        const account = MultiSigAccount.fromDescriptor(descriptor).expect(descriptor)
        const reloaded = MultiSigAccount.fromDescriptor(account.toString()).expect(account.toString())
        for (const change of changes(range)) {
          const pubkeys = keys.map((key) => childKey(key, change, index))
          // BIP 67: sortedmulti orders the derived keys, multi keeps the descriptor's order.
          const ordered = sorted ? [...pubkeys].sort((a, b) => a.compare(b)) : pubkeys
          const expected = multisigAddress(script, threshold, ordered, networks[network])
          expect(account.address(change, index).toString()).toBe(expected)
          expect(reloaded.address(change, index).toString()).toBe(expected)
        }
      }),
    )
    // Key derivation is slow, and other suites run alongside.
  }, 60_000)
})

/** The key in each private format wallets export: xprv, tprv and the SLIP-132 variants. */
function privateVariants(privateKey: string): string[] {
  const origin = /^\[.*?\]/.exec(privateKey)?.[0] ?? ''
  const body = bs58check.decode(privateKey.slice(origin.length)).subarray(4)
  return ['0488ade4', '04358394', '049d7878', '04b2430c', '0295b005', '02aa7a99'].map(
    (version) => `${origin}${bs58check.encode(Buffer.concat([Buffer.from(version, 'hex'), body]))}`,
  )
}

describe('private keys in descriptors', () => {
  it('are found in any position and format, and public-only descriptors pass', () => {
    fc.assert(
      fc.property(
        multisigArbitrary,
        fc.nat(),
        fc.nat(5),
        ({ keys, script, sorted, threshold, range }, position, variant) => {
          const at = position % keys.length
          const privateKey = privateVariants(keys[at]?.privateKey ?? '')[variant] ?? ''
          const mixed = keys.map((key, index) => `${index === at ? privateKey : key.publicKey}${range}`)
          const publicOnly = keys.map((key) => `${key.publicKey}${range}`)
          expect(containsExtendedPrivateKey(multisigDescriptor(script, sorted, threshold, mixed))).toBe(true)
          expect(containsExtendedPrivateKey(multisigDescriptor(script, sorted, threshold, publicOnly))).toBe(false)
        },
      ),
    )
    // Key derivation is slow, and other suites run alongside.
  }, 60_000)
})
