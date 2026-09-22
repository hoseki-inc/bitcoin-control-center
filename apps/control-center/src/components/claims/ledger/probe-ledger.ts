import { DerivationPath, Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { type AsyncResult, Err, Ok, Result, asyncFn } from '@hoseki/packages/result'
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
export const probeLedger = asyncFn(async function (
  trpcUtils: ReturnType<typeof trpc.useUtils>,
  ctx: {
    signal?: AbortSignal
    isCurrentConnection: () => boolean
    getBitcoinXpub: (
      scriptType: 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr',
      account: number,
    ) => AsyncResult<{ xpub: string; path: string }, Error>
  },
) {
  const wallets: HardwareWallet[] = []
  const isCancelled = (): boolean => !!ctx.signal?.aborted || !ctx.isCurrentConnection()
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
      if (dataRes.isErr()) {
        const xpubErr = dataRes.unwrapErr()
        if (xpubErr instanceof HardwareDeviceError) {
          captureHardwareWalletError(
            xpubErr,
            'Failed to get xpub',
            { wallet: 'ledger', step: 'scan' },
            { scriptType, account },
          )
        }
        return dataRes
      }
      const data = dataRes.unwrap()

      browserLogger.debug('found xpub for', { scriptType, account, data: dataRes })

      const xpub = Slip132.getXpubFromString(data.xpub)
      if (xpub.isErr()) {
        browserLogger.error({ error: xpub.unwrapErr() }, 'Failed to parse xpub')
        return Err(new Error(`Failed to parse xpub: ${xpub.unwrapErr().message}`, { cause: xpub.unwrapErr() }))
      }

      const derivationPath = DerivationPath.fromString(data.path)
      if (derivationPath.isErr()) {
        browserLogger.error({ error: derivationPath.unwrapErr() }, 'Failed to parse derivation path')
        return Err(
          new Error(`Failed to parse derivation path: ${derivationPath.unwrapErr().message}`, {
            cause: derivationPath.unwrapErr(),
          }),
        )
      }

      const count = account + 1

      batch.push({
        account,
        derivationPath,
        rawInput: data.xpub,
        networkAccount: new NetworkAccount(Network.Mainnet, new SingleSigAccount(scriptType, xpub.unwrap())), // Ledger only supports mainnet
        label: `Bitcoin ${count}`,

        // This is trying to match how it would look like in the Ledger Live app
        // e.g., Bitcoin Legacy 1, Bitcoin Segwit 1, Bitcoin Segwit 2, etc.
        displayName: `Bitcoin ${scriptTypeToLedgerScriptLabel(scriptType)} ${count}`,
      })
    }

    browserLogger.debug('looking up batch balances', batch)

    const accounts = batch.map(({ networkAccount }) => networkAccount.toString())

    const balancesRes = await Result.fromPromise(
      trpcUtils.portalProve.onchain.bitcoinAccountBalances.fetch({ accounts }),
    )
    if (isCancelled()) {
      return cancelled()
    }
    if (balancesRes.isErr()) {
      throw balancesRes.unwrapErr()
    }
    const balances = balancesRes.unwrap()

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
            derivationPath: wallet.derivationPath.unwrap(),
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
