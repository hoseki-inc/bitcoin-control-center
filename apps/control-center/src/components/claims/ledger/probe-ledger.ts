import { DerivationPath, Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import type { AsyncResult } from '@hoseki/packages/result'
import { Err, Ok, Result, tryBlock } from '@hoseki/packages/result'
import type { HardwareWallet } from '@hoseki/packages/ui/wallet-ui'
import { HardwareDeviceError, Slip132 } from '@hoseki/packages/wallet'
import { browserLogger, captureHardwareWalletError } from '../../../logger'
import type { trpc } from '../../../trpc'

export function scriptTypeToLedgerScriptLabel(scriptType: SingleSigAccount['scriptType']): string {
  switch (scriptType) {
    case 'p2pkh':
      return 'Legacy'
    case 'p2sh-p2wpkh':
      return 'Segwit' // Ledger uses "Segwit" for P2SH-P2WPKH, instead of "Nested Segwit"
    case 'p2wpkh':
      return 'Native Segwit'
    case 'p2tr':
      return 'Taproot'
  }
}

/**
 * Probes a Ledger device for all available Bitcoin accounts and returns a list of wallets with balances.
 */
export const probeLedger = (
  trpcUtils: {
    portalProve: {
      onchain: {
        bitcoinAccountBalances: Pick<
          ReturnType<typeof trpc.useUtils>['portalProve']['onchain']['bitcoinAccountBalances'],
          'fetch'
        >
      }
    }
  },
  ctx: {
    signal?: AbortSignal
    isCurrentConnection: () => boolean
    getBitcoinXpub: (
      scriptType: 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr',
      account: number,
    ) => AsyncResult<{ xpub: string; path: string }, Error>
  },
): AsyncResult<HardwareWallet[], Error> =>
  tryBlock(async function* () {
    const wallets: HardwareWallet[] = []
    const isCancelled = (): boolean => ctx.signal?.aborted === true || !ctx.isCurrentConnection()
    const cancelled = (): Result<never, Error> => Err(new DOMException('Ledger scan cancelled', 'AbortError'))

    // Check every script type's first account
    let toCheck = [
      { scriptType: 'p2pkh' as const, account: 0 },
      { scriptType: 'p2wpkh' as const, account: 0 },
      { scriptType: 'p2sh-p2wpkh' as const, account: 0 },
      { scriptType: 'p2tr' as const, account: 0 },
    ]

    // Allow Strict Mode's immediate cancellation to stop this scan before it takes the device lock.
    await Promise.resolve()

    while (toCheck.length > 0) {
      const batch = []

      // This needs to be a for loop because `getBitcoinXpub` is a locking operation so cannot be parallelized
      for (const { scriptType, account } of toCheck) {
        if (isCancelled()) {
          return cancelled()
        }
        const dataRes = await ctx.getBitcoinXpub(scriptType, account)
        if (isCancelled()) {
          return cancelled()
        }
        const data = yield* dataRes.inspectErr((xpubErr) => {
          if (xpubErr instanceof HardwareDeviceError) {
            captureHardwareWalletError(
              xpubErr,
              'Failed to get xpub',
              { wallet: 'ledger', step: 'scan' },
              { scriptType, account },
            )
          }
        })

        browserLogger.debug('found xpub for', { scriptType, account, data: dataRes })

        const xpub = yield* Slip132.getXpubFromString(data.xpub)
          .inspectErr((error) => {
            browserLogger.error({ error }, 'Failed to parse xpub')
          })
          .mapErr((error) => new Error(`Failed to parse xpub: ${error.message}`, { cause: error }))

        const derivationPath = yield* DerivationPath.fromString(data.path)
          .inspectErr((error) => {
            browserLogger.error({ error }, 'Failed to parse derivation path')
          })
          .mapErr((error) => new Error(`Failed to parse derivation path: ${error.message}`, { cause: error }))

        const count = account + 1

        batch.push({
          account,
          derivationPath,
          rawInput: data.xpub,
          networkAccount: new NetworkAccount(Network.Mainnet, new SingleSigAccount(scriptType, xpub)), // Ledger only supports mainnet
          label: `Bitcoin ${count}`,

          // This is trying to match how it would look like in the Ledger Live app
          // e.g., Bitcoin Legacy 1, Bitcoin Segwit 1, Bitcoin Segwit 2, etc.
          displayName: `Bitcoin ${scriptTypeToLedgerScriptLabel(scriptType)} ${count}`,
        })
      }

      browserLogger.debug('looking up batch balances', batch)

      const accounts = batch.map(({ networkAccount }) => networkAccount.toString())

      // Delegating parsed Results above can suspend the async generator.
      if (isCancelled()) {
        return cancelled()
      }
      const balancesRes = await Result.fromPromise(
        trpcUtils.portalProve.onchain.bitcoinAccountBalances.fetch({ accounts }),
      )
      if (isCancelled()) {
        return cancelled()
      }
      const balances = yield* balancesRes
      if (isCancelled()) {
        return cancelled()
      }

      for (const [acc, balance] of balances.accounts) {
        const wallet = batch.find(({ networkAccount }) => networkAccount.toString() === acc)
        if (wallet) {
          // Remove the checked account and add the next account for the same script type
          toCheck = toCheck.filter(({ scriptType, account }) => {
            return scriptType !== wallet.networkAccount.account.scriptType || account !== wallet.account
          })
          browserLogger.debug('removing', {
            scriptType: wallet.networkAccount.account.scriptType,
            account: wallet.account,
            toCheck,
          })

          if (balance.current.gt(0) || balances.archivedAccounts.has(acc)) {
            // Store the wallet if it has a balance
            wallets.push({
              rawInput: wallet.rawInput,
              displayName: wallet.displayName,
              account: wallet.networkAccount.account,
              derivationPath: wallet.derivationPath,
              accountIndex: wallet.account,
              label: wallet.label,
              btcBalance: balance.current,
              usdBalance: balance.usd,
            })
            // Add the next account for the same script type if balance is non-zero
            toCheck.push({ scriptType: wallet.networkAccount.account.scriptType, account: wallet.account + 1 })
            browserLogger.debug(
              'found balance for account',
              { scriptType: wallet.networkAccount.account.scriptType, account: wallet.account },
              'adding next index',
              toCheck,
            )
          }
        }
      }
    }

    return Ok(wallets)
  })
