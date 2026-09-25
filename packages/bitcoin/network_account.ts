import { Err, type Result } from '@hoseki/packages/result'
import type { Opaque } from 'type-fest'
import { Account } from './account'
import { Network } from './network'

export type NetworkAccountJson = { network: string; account: string }

export type NetworkAccountCheckedString = Opaque<
  `${'bitcoin_mainnet' | 'bitcoin_testnet' | 'bitcoin_regtest'}::${string}`,
  'NetworkAccountString'
>

/**
 * Encapsulates a bitcoin account and its network. There is no validation to check if the account is valid on the network.
 */
export class NetworkAccount<T extends Account = Account> {
  public static fromString(str: string): Result<NetworkAccount, Error> {
    const [network, account] = str.split('::')
    if (network == null || network === '' || account == null || account === '') {
      return Err(
        new Error(
          'Invalid format, expected "bitcoin_mainnet::<account>", "bitcoin_testnet::<account>", or "bitcoin_regtest::<account>"',
        ),
      )
    }
    return Network.fromStringRaw(network).andThen((n) => {
      return Account.fromDescriptor(account).map((parsedAccount) => {
        return new NetworkAccount(n, parsedAccount)
      })
    })
  }

  public static fromCheckedString(str: NetworkAccountCheckedString): NetworkAccount {
    return this.fromString(str).expect('Expected checked network account string')
  }

  public readonly network: Network
  public readonly account: T

  public constructor(network: Network, account: T) {
    this.network = network
    this.account = account
  }

  public key(): NetworkAccountCheckedString {
    return this.toString()
  }

  public toString(): NetworkAccountCheckedString {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: Both serialized components come from typed Network and Account values; external strings are checked by fromString.
    return `${this.network.toString()}::${this.account.toString()}` as NetworkAccountCheckedString
  }

  public toJSON(): NetworkAccountJson {
    return {
      network: this.network.toString(),
      account: this.account.toString(),
    }
  }
}
