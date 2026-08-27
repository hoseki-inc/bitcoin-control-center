import { Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import type { HardwareWallet, KeystoneExportFile } from '@hoseki/packages/ui/wallet-ui'
import { useBitcoinAccountBalances } from '../../../lib/balance/bitcoin-account'

type BalancesQuery = ReturnType<typeof useBitcoinAccountBalances>

interface UseKeystoneAccountsWithBalancesReturn extends Omit<BalancesQuery, 'data'> {
  data: HardwareWallet[]
}

/**
 * Uses the xpub from the Keystone export as a p2wpkh (native segwit) account.
 * The Keystone single-sig QR displays a raw zpub string.
 */
export function useKeystoneAccountsWithBalances(
  keystoneExport: KeystoneExportFile,
): UseKeystoneAccountsWithBalancesReturn {
  const account = new SingleSigAccount('p2wpkh', keystoneExport.xpub)
  const networkAccount = new NetworkAccount(Network.Mainnet, account)

  const balancesQuery = useBitcoinAccountBalances([networkAccount.toString()], { enabled: true })

  const wallets: HardwareWallet[] = []
  if (balancesQuery.data?.accounts) {
    const balance = balancesQuery.data.accounts.get(networkAccount.toString())
    if (balance && (balance.current.gt(0) || balancesQuery.data.archivedAccounts.has(networkAccount.toString()))) {
      wallets.push({
        accountIndex: 0,
        rawInput: keystoneExport.xpub.toString(),
        account,
        btcBalance: balance.current,
        usdBalance: balance.usd,
        displayName: 'Keystone Wallet',
        label: 'Keystone Wallet',
        derivationPath: keystoneExport.derivationPath,
      })
    }
  }

  return {
    ...balancesQuery,
    data: wallets,
  }
}
