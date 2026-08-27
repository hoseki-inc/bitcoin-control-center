import { Err, Ok, Result } from '@patina/core'
import type { Opaque } from 'type-fest'
import * as descriptor from './descriptor_utils'
import { bitcoin } from './lib'
import { Network } from './network'

export type FormatKind = 'base58check' | 'bech32'

export type CheckedAddressString = Opaque<string, 'CheckedAddressString'>
export type CheckedAddressDescriptor = `addr(${CheckedAddressString})`

export const FORMATS = {
  MAINNET_PUBKEY_HASH: {
    kind: 'base58check',
    network: Network.Mainnet,
    version: Network.Mainnet.pubKeyHashDecimal,
  },
  MAINNET_SCRIPT_HASH: {
    kind: 'base58check',
    network: Network.Mainnet,
    version: Network.Mainnet.scriptHashDecimal,
  },
  TESTNET_PUBKEY_HASH: {
    kind: 'base58check',
    network: Network.Testnet,
    version: Network.Testnet.pubKeyHashDecimal,
  },
  TESTNET_SCRIPT_HASH: {
    kind: 'base58check',
    network: Network.Testnet,
    version: Network.Testnet.scriptHashDecimal,
  },
  MAINNET_SEGWIT: {
    kind: 'bech32',
    network: Network.Mainnet,
    version: 0,
  },
  MAINNET_TAPROOT: {
    kind: 'bech32',
    network: Network.Mainnet,
    version: 1,
  },
  TESTNET_SEGWIT: {
    kind: 'bech32',
    network: Network.Testnet,
    version: 0,
  },
  TESTNET_TAPROOT: {
    kind: 'bech32',
    network: Network.Testnet,
    version: 1,
  },
  REGTEST_SEGWIT: {
    kind: 'bech32',
    network: Network.Regtest,
    version: 0,
  },
  REGTEST_TAPROOT: {
    kind: 'bech32',
    network: Network.Regtest,
    version: 1,
  },
} as const satisfies Record<
  string,
  {
    kind: FormatKind
    network: Network
    version: number
  }
>

export type FormatKey = keyof typeof FORMATS
export type Format = (typeof FORMATS)[FormatKey]

class UnsupportedVersionError extends Error {
  constructor(version: number) {
    super(`Unsupported version: "${version}"`)
  }
}

class UnsupportedPrefixError extends Error {
  constructor(prefix: string) {
    super(`Unsupported prefix: "${prefix}"`)
  }
}

export type AddressType = 'legacy' | 'script' | 'segwit' | 'taproot'

export class Address {
  public static isAddress(value: unknown): value is Address {
    return value instanceof Address
  }

  public static fromBase58Check(str: string): Result<Address, Error> {
    return Result.fromThrowable(() => {
      return bitcoin.address.fromBase58Check(str)
    }).andThen((b58) => {
      switch (b58.version) {
        case FORMATS.MAINNET_PUBKEY_HASH.version:
          return Ok(new Address(FORMATS.MAINNET_PUBKEY_HASH, b58.hash))
        case FORMATS.MAINNET_SCRIPT_HASH.version:
          return Ok(new Address(FORMATS.MAINNET_SCRIPT_HASH, b58.hash))
        case FORMATS.TESTNET_PUBKEY_HASH.version:
          return Ok(new Address(FORMATS.TESTNET_PUBKEY_HASH, b58.hash))
        case FORMATS.TESTNET_SCRIPT_HASH.version:
          return Ok(new Address(FORMATS.TESTNET_SCRIPT_HASH, b58.hash))
        default:
          return Err(new UnsupportedVersionError(b58.version))
      }
    })
  }

  public static fromBech32(str: string): Result<Address, Error> {
    return Result.fromThrowable(() => {
      return bitcoin.address.fromBech32(str)
    }).andThen((b32) => {
      switch (b32.prefix) {
        case FORMATS.MAINNET_SEGWIT.network.bech32:
          switch (b32.version) {
            case FORMATS.MAINNET_SEGWIT.version:
              return Ok(new Address(FORMATS.MAINNET_SEGWIT, b32.data))
            case FORMATS.MAINNET_TAPROOT.version:
              return Ok(new Address(FORMATS.MAINNET_TAPROOT, b32.data))
            default:
              return Err(new UnsupportedVersionError(b32.version))
          }
        case FORMATS.TESTNET_SEGWIT.network.bech32:
          switch (b32.version) {
            case FORMATS.TESTNET_SEGWIT.version:
              return Ok(new Address(FORMATS.TESTNET_SEGWIT, b32.data))
            case FORMATS.TESTNET_TAPROOT.version:
              return Ok(new Address(FORMATS.TESTNET_TAPROOT, b32.data))
            default:
              return Err(new UnsupportedVersionError(b32.version))
          }
        case FORMATS.REGTEST_SEGWIT.network.bech32:
          switch (b32.version) {
            case FORMATS.REGTEST_SEGWIT.version:
              return Ok(new Address(FORMATS.REGTEST_SEGWIT, b32.data))
            case FORMATS.REGTEST_TAPROOT.version:
              return Ok(new Address(FORMATS.REGTEST_TAPROOT, b32.data))
            default:
              return Err(new UnsupportedVersionError(b32.version))
          }
        default:
          return Err(new UnsupportedPrefixError(b32.prefix))
      }
    })
  }

  public static fromString(str: string): Result<Address, Error> {
    const errors: Error[] = []
    return this.fromBase58Check(str)
      .mapErr((e) => {
        errors.push(e)
        return e
      })
      .orElse(() => {
        return this.fromBech32(str)
      })
      .mapErr((e) => {
        errors.push(e)
        return new Error(`Invalid address format`, { cause: new AggregateError(errors) })
      })
  }

  public static fromCheckedString(str: CheckedAddressString): Address {
    return this.fromString(str).expect(`${str} should be a valid address`)
  }

  public static fromDescriptor(descriptor: string): Result<Address, Error> {
    const address = descriptor.slice(5, -1) // Slice off "addr(" and ")"
    return this.fromString(address)
  }

  public static fromCheckedDescriptor(desc: CheckedAddressDescriptor): Address {
    return this.fromDescriptor(desc).expect(`${desc} should be a valid address descriptor`)
  }

  public readonly format: Format
  public readonly data: Buffer

  public constructor(format: Format, data: Buffer) {
    this.format = format
    this.data = data
  }

  public toString(): CheckedAddressString {
    let ret: string
    switch (this.format.kind) {
      case 'base58check':
        ret = bitcoin.address.toBase58Check(this.data, this.format.version)
        break
      case 'bech32':
        ret = bitcoin.address.toBech32(this.data, this.format.version, this.format.network.bech32)
        break
    }
    return ret as CheckedAddressString
  }

  public toJSON(): string {
    return this.toString()
  }

  public key(): string {
    return this.toString()
  }

  public descriptor(): CheckedAddressDescriptor {
    return descriptor.addr(this.toString())
  }

  public eq(other: Address): boolean {
    return this.toString() === other.toString()
  }

  public network(): Network {
    return this.format.network
  }

  public type(): AddressType {
    switch (this.format.kind) {
      case 'base58check':
        switch (this.format.version) {
          case Network.Mainnet.pubKeyHashDecimal:
          case Network.Testnet.pubKeyHashDecimal:
            return 'legacy'
          case Network.Mainnet.scriptHashDecimal:
          case Network.Testnet.scriptHashDecimal:
            return 'script'
        }

      // ESlint is stupid here, there is no fallthrough, in fact I can't even add a break statement because TS will report unreachable code
      // @eslint-disable-next-line no-fallthrough
      case 'bech32':
        switch (this.format.version) {
          case 0:
            return 'segwit'
          case 1:
            return 'taproot'
        }
    }
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString()
  }
}
