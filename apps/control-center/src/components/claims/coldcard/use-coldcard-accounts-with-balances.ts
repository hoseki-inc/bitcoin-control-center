import { type DerivationPath, Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import type {
  ColdcardGenericJsonFile,
  ColdcardModel,
  ColdcardSingleSigAccount,
  HardwareWallet,
} from '@hoseki/packages/ui/wallet-ui'
import { useBitcoinAccountBalances } from '../../../lib/balance/bitcoin-account'

type BalancesQuery = ReturnType<typeof useBitcoinAccountBalances>

interface UseColdcardAccountsWithBalancesReturn extends Omit<BalancesQuery, 'data'> {
  data: HardwareWallet[]
}

function makeAccount(acc: ColdcardSingleSigAccount): {
  network: Network
  account: SingleSigAccount
  derivationPath: DerivationPath | null
  rawInput: string
} {
  if (acc.desc) {
    return {
      network: Network.Mainnet,
      account: acc.desc,
      derivationPath: acc.deriv,
      rawInput: acc.desc.toString(),
    }
  }
  return {
    network: Network.Mainnet,
    account: new SingleSigAccount(acc.name, acc.xpub),
    derivationPath: acc.deriv,
    rawInput: JSON.stringify(acc),
  }
}

export function useColdcardAccountsWithBalances(
  coldcardJson: ColdcardGenericJsonFile,
  model: ColdcardModel,
): UseColdcardAccountsWithBalancesReturn {
  const accounts = [makeAccount(coldcardJson.bip44)]
  if (coldcardJson.bip49) {
    accounts.push(makeAccount(coldcardJson.bip49))
  }
  if (coldcardJson.bip84) {
    accounts.push(makeAccount(coldcardJson.bip84))
  }

  const balancesQueryEnabled = accounts.length > 0
  const balancesQuery = useBitcoinAccountBalances(
    accounts.map((a) => new NetworkAccount(a.network, a.account).toString()),
    { enabled: balancesQueryEnabled },
  )

  const wallets: HardwareWallet[] = []
  if (balancesQuery.data?.accounts) {
    for (const account of accounts) {
      const networkAccount = new NetworkAccount(account.network, account.account).toString()
      const balance = balancesQuery.data.accounts.get(networkAccount)
      if (balance && (balance.current.gt(0) || balancesQuery.data.archivedAccounts.has(networkAccount))) {
        wallets.push({
          accountIndex: coldcardJson.account,
          rawInput: account.rawInput,
          account: account.account,
          btcBalance: balance.current,
          usdBalance: balance.usd,
          displayName: `Coldcard ${model} Wallet`,
          label: `Coldcard ${model} Wallet`,
          derivationPath: account.derivationPath,
        })
      }
    }
  }

  return {
    ...balancesQuery,
    data: wallets,
  }
}
