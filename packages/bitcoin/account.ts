import type { Opaque } from 'type-fest'
import { Err, Panic, Result } from '../result'
import {
  type MultiSigAccountScriptType,
  type SingleSigAccountScriptType,
  checkMultisigAccountProps,
} from './account_props'
import { Address } from './address'
import * as descriptor from './descriptor_utils'
import { bitcoin } from './lib/bitcoin'
import { Network } from './network'
import { Wallet } from './wallet'
import type { Xpub } from './xpub'

export type CheckedAccountDescriptor = CheckedSinglesigAccountDescriptor | CheckedMultisigAccountDescriptor

export namespace Account {
  /**
   * Tries to parse a single sig account descriptor first, and if that fails, tries to parse a multisig account descriptor.
   */
  export function fromDescriptor(desc: string): Result<Account, Error> {
    return SingleSigAccount.fromDescriptor(desc).orElse(() => MultiSigAccount.fromDescriptor(desc))
  }

  /**
   * Tries to parse a single sig account descriptor first, and if that fails, tries to parse a multisig account descriptor.
   *
   * Panics if the descriptor is not valid.
   */
  export function fromCheckedDescriptor(desc: CheckedAccountDescriptor): Account {
    return Account.fromDescriptor(desc).expect('account should be valid using checked descriptor')
  }
}

export type Account = SingleSigAccount | MultiSigAccount

export type CheckedSinglesigAccountDescriptor = Opaque<string, 'CheckedSinglesigAccountDescriptor'>
export type CheckedMultisigAccountDescriptor = Opaque<string, 'CheckedMultisigAccountDescriptor'>

/**
 * Encapsulates the properties required to generate addresses from a single sig account.
 *
 * If you need additional key data like fingerprint or derivation path, use the `Wallet` class instead.
 */
export class SingleSigAccount {
  public readonly scriptType: SingleSigAccountScriptType
  public readonly xpub: Xpub

  public constructor(scriptType: SingleSigAccountScriptType, xpub: Xpub) {
    this.scriptType = scriptType
    this.xpub = xpub
  }

  public static fromWallet(wallet: Wallet.Singlesig): SingleSigAccount {
    return new SingleSigAccount(wallet.scriptType, wallet.keyExpression.xpub)
  }

  public static fromDescriptor(desc: string): Result<SingleSigAccount, Error> {
    return Wallet.Singlesig.fromDescriptor(desc).map((wallet) => SingleSigAccount.fromWallet(wallet))
  }

  public static fromCheckedDescriptor(desc: CheckedSinglesigAccountDescriptor): SingleSigAccount {
    return SingleSigAccount.fromDescriptor(desc).expect('single sig account should be valid using checked descriptor')
  }

  public descriptor(): CheckedSinglesigAccountDescriptor {
    let desc: string = descriptor.accountRange(this.xpub.toString())
    switch (this.scriptType) {
      case 'p2pkh':
        desc = descriptor.pkh(desc)
        break
      case 'p2sh-p2wpkh':
        desc = descriptor.sh(descriptor.wpkh(desc))
        break
      case 'p2wpkh':
        desc = descriptor.wpkh(desc)
        break
      case 'p2tr':
        desc = descriptor.tr(desc)
        break
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Brand the checksummed descriptor built from the typed singlesig account.
    return descriptor.checksum(desc).expect('checksum should be valid') as CheckedSinglesigAccountDescriptor
  }

  /**
   * Returns the network of the account based on the xpub format.
   *
   * Even though testnet and regtest produce different addresses, it is not possible to disambiguate between them using the account descriptor or xpub format because they both use the same version bytes.
   */
  public network(): Network.Mainnet | Network.Testnet {
    return this.xpub.network
  }

  public address(change: 0 | 1, index: number, network: Network = this.network()): Address {
    return this.xpub.derive(change).derive(index).address(this.scriptType, network)
  }

  public receiveAddress(index: number, network?: Network): Address {
    return this.address(0, index, network)
  }

  public changeAddress(index: number, network?: Network): Address {
    return this.address(1, index, network)
  }

  /**
   * End is exclusive.
   */
  public addresses(change: 0 | 1, start: number, end: number, network?: Network): Address[] {
    const addresses = []
    for (let i = start; i < end; i++) {
      addresses.push(this.address(change, i, network))
    }
    return addresses
  }

  /**
   * End is exclusive.
   */
  public receiveAddresses(start: number, end: number, network?: Network): Address[] {
    return this.addresses(0, start, end, network)
  }

  /**
   * End is exclusive.
   */
  public changeAddresses(start: number, end: number, network?: Network): Address[] {
    return this.addresses(1, start, end, network)
  }

  public toString(): CheckedSinglesigAccountDescriptor {
    return this.descriptor()
  }

  public key(): CheckedSinglesigAccountDescriptor {
    return this.toString()
  }

  public toJSON(): CheckedSinglesigAccountDescriptor {
    return this.toString()
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString()
  }
}

export type MultiSigAccountProps = {
  scriptType: MultiSigAccountScriptType
  threshold: number
  isSorted: boolean
  xpubs: Xpub[]
}

/**
 * Encapsulates the properties required to generate addresses from a multisig account.
 *
 * If you need additional key data like fingerprint or derivation path, use the `Wallet` class instead.
 */
export class MultiSigAccount {
  public readonly scriptType: MultiSigAccountScriptType
  public readonly threshold: number
  public readonly isSorted: boolean
  public readonly xpubs: Xpub[]

  public constructor(scriptType: MultiSigAccountScriptType, threshold: number, isSorted: boolean, xpubs: Xpub[]) {
    this.scriptType = scriptType
    this.threshold = threshold
    this.isSorted = isSorted
    this.xpubs = xpubs
  }

  public static from(args: MultiSigAccountProps): Result<MultiSigAccount, Error> {
    return checkMultisigAccountProps(args).map(
      (props) => new MultiSigAccount(props.scriptType, props.threshold, props.isSorted, props.xpubs),
    )
  }

  public static fromWallet(wallet: Wallet.Multisig): MultiSigAccount {
    return MultiSigAccount.from({
      scriptType: wallet.scriptType,
      threshold: wallet.threshold,
      isSorted: wallet.isSorted,
      xpubs: wallet.keyExpressions.map((ke) => ke.xpub),
    }).expect('multisig wallet should be valid')
  }

  /**
   * Transforms string into structured object, validate content and narrow its type.
   * @param descriptor Output descriptor, example: 'sh(wsh(sortedmulti(2,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*)))#mkl9ckkl'
   * @returns Ok<Multisig> or Err<Error>
   */
  public static fromDescriptor(string: string): Result<MultiSigAccount, Error> {
    return Wallet.Multisig.fromDescriptor(string).map((wallet) => MultiSigAccount.fromWallet(wallet))
  }

  public static fromCheckedDescriptor(desc: CheckedMultisigAccountDescriptor): MultiSigAccount {
    return MultiSigAccount.fromDescriptor(desc).expect('multisig account should be valid using checked descriptor')
  }

  public descriptor(): CheckedMultisigAccountDescriptor {
    const xpubs = this.isSorted ? sortXpubs(this.xpubs) : this.xpubs
    const xpubsWithAccRange = xpubs.map((xpub) => descriptor.accountRange(xpub.toString()))

    let desc: string = this.isSorted
      ? descriptor.sortedmulti(this.threshold, xpubsWithAccRange)
      : descriptor.multi(this.threshold, xpubsWithAccRange)
    switch (this.scriptType) {
      case 'p2sh':
        desc = descriptor.sh(desc)
        break
      case 'p2sh-p2wsh':
        desc = descriptor.sh(descriptor.wsh(desc))
        break
      case 'p2wsh':
        desc = descriptor.wsh(desc)
        break
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Brand the checksummed descriptor built from the typed multisig account.
    return descriptor.checksum(desc).expect('checksum should be valid') as CheckedMultisigAccountDescriptor
  }

  /**
   * Returns the network of the account based on the xpub format.
   *
   * Even though testnet and regtest produce different addresses, it is not possible to disambiguate between them using the account descriptor or xpub format because they both use the same version bytes.
   */
  public network(): Network.Mainnet | Network.Testnet {
    const firstXpub = this.xpubs[0]
    if (!firstXpub) {
      throw new Panic('xpubs should not be empty')
    }
    return firstXpub.network.kind === 'Mainnet' ? firstXpub.network : Network.Testnet
  }

  public address(change: 0 | 1, index: number, network: Network = this.network()): Address {
    return Result.fromThrowable(() => {
      let pubkeys = this.xpubs.map((xpub) => xpub.derive(change).derive(index).publicKey())
      pubkeys = this.isSorted ? pubkeys.sort((a, b) => a.toString('hex').localeCompare(b.toString('hex'))) : pubkeys

      const redeem = bitcoin.payments.p2ms({ m: this.threshold, pubkeys, network })

      const args = {
        redeem,
        network,
      }

      switch (this.scriptType) {
        case 'p2sh':
          return bitcoin.payments.p2sh(args).address
        case 'p2sh-p2wsh':
          return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wsh(args), network }).address
        case 'p2wsh':
          return bitcoin.payments.p2wsh(args).address
      }
    })
      .andThen((address) => {
        if (!address) {
          return Err(new Error('Invalid address encoding'))
        }
        return Address.fromString(address)
      })
      .expect('address should have been generated')
  }

  public receiveAddress(index: number, network?: Network): Address {
    return this.address(0, index, network)
  }

  public changeAddress(index: number, network?: Network): Address {
    return this.address(1, index, network)
  }

  /**
   * End is exclusive.
   */
  public addresses(change: 0 | 1, start: number, end: number, network?: Network): Address[] {
    const addresses = []
    for (let i = start; i < end; i++) {
      addresses.push(this.address(change, i, network))
    }
    return addresses
  }

  /**
   * End is exclusive.
   */
  public receiveAddresses(start: number, end: number, network?: Network): Address[] {
    return this.addresses(0, start, end, network)
  }

  /**
   * End is exclusive.
   */
  public changeAddresses(start: number, end: number, network?: Network): Address[] {
    return this.addresses(1, start, end, network)
  }

  public toString(): CheckedMultisigAccountDescriptor {
    return this.descriptor()
  }

  public key(): CheckedMultisigAccountDescriptor {
    return this.toString()
  }

  public toJSON(): CheckedMultisigAccountDescriptor {
    return this.toString()
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString()
  }
}

/**
 * Sorts XPUBs in lexicographic order (ascending order)
 */
export function sortXpubs(xpubs: Xpub[]): Xpub[] {
  return [...xpubs].sort((a, b) => a.publicKey().toString('hex').localeCompare(b.publicKey().toString('hex')))
}
