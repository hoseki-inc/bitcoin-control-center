import type { Opaque } from 'type-fest'
import { Err, Result } from '../result'
import { Address } from './address'
import { type BIP32Interface, bip32, bitcoin } from './lib'
import { Network } from './network'

export type CheckedXpubString = Opaque<string, 'CheckedXpubString'>

export class Xpub {
  public static fromString(string: string): Result<Xpub, Error> {
    // Only accept core xpub/tpub strings (no SLIP-132 prefixes like ypub, zpub, etc.)
    const firstChar = string[0]
    let network: Network.Mainnet | Network.Testnet

    switch (firstChar) {
      case 'x':
        network = Network.Mainnet
        break
      case 't':
        network = Network.Testnet
        break
      case undefined:
      default:
        return Err(
          new Error(
            `Xpub.fromString only accepts core xpub/tpub strings. Got first character: "${firstChar}". ` +
              `If you need to parse SLIP-132 extended public keys (ypub, zpub, etc.), use the wallet package utilities instead.`,
          ),
        )
    }

    return Result.fromThrowable(() => {
      const spec = bip32.fromBase58(string, network)
      return new Xpub(spec, network)
    })
  }

  public static fromCheckedString(string: CheckedXpubString): Xpub {
    return Xpub.fromString(string).expect('input string should have been a valid xpub')
  }

  private readonly spec: BIP32Interface
  public readonly network: Network.Mainnet | Network.Testnet

  public constructor(spec: BIP32Interface, network: Network.Mainnet | Network.Testnet) {
    this.spec = spec
    this.network = network
  }

  public publicKey(): Buffer {
    return this.spec.publicKey
  }

  public derive(index: number): Xpub {
    return new Xpub(this.spec.derive(index), this.network)
  }

  public deriveHardened(index: number): Xpub {
    return new Xpub(this.spec.deriveHardened(index), this.network)
  }

  /**
   * See Taproot example: https://github.com/bitcoinjs/bitcoinjs-lib/pull/1874
   */
  private taprootAddress(network: Network) {
    // In the case of Taproot, the public key must be a x-only coordinate (32 bytes) without the y-coordinate information
    const internalPubkey = this.publicKey().subarray(1, 33)
    return bitcoin.payments.p2tr({ internalPubkey, network }).address
  }

  /**
   * This is a shorthand for generating an address from an xpub.
   *
   * You should probably use `address()` method on an Account object instead.
   */
  public address(scriptType: 'p2pkh' | 'p2wpkh' | 'p2sh-p2wpkh' | 'p2tr', network: Network): Address {
    return Result.fromThrowable(() => {
      const args = {
        pubkey: this.publicKey(),
        network,
      }
      switch (scriptType) {
        case 'p2pkh':
          return bitcoin.payments.p2pkh(args).address
        case 'p2wpkh':
          return bitcoin.payments.p2wpkh(args).address
        case 'p2sh-p2wpkh':
          return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh(args) }).address
        case 'p2tr':
          return this.taprootAddress(network)
      }
    })
      .andThen((address) => {
        if (address == null || address === '') {
          return Err(new Error('failed to generate address from xpub'))
        }
        return Address.fromString(address)
      })
      .expect('valid address should have been generated')
  }

  public toString(): CheckedXpubString {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- BIP32 serializes this constructed key; external strings use fromString.
    return Result.fromThrowable(() => this.spec.toBase58() as CheckedXpubString).expect(
      'instance should have been a valid xpub that can be encoded to base58',
    )
  }

  public equals(other: Xpub): boolean {
    return this.toString() === other.toString()
  }

  public toJSON(): CheckedXpubString {
    return this.toString()
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): CheckedXpubString {
    return this.toString()
  }
}
