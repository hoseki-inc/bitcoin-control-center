import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import type { NetworkAccountCheckedString } from '@hoseki/packages/bitcoin'
import type { inferProcedureOutput } from '@trpc/server'
import { trpc } from '../../trpc'

type BitcoinAccountBalancesOutput = inferProcedureOutput<Router['portalProve']['onchain']['bitcoinAccountBalances']>

export type UseBitcoinAccountBalancesReturn = ReturnType<
  typeof trpc.portalProve.onchain.bitcoinAccountBalances.useQuery<BitcoinAccountBalancesOutput>
>

/**
 * Hook to fetch Bitcoin account balances with centralized rate limit error handling
 */
export function useBitcoinAccountBalances(
  accounts: NetworkAccountCheckedString[],
  options?: { enabled?: boolean },
): UseBitcoinAccountBalancesReturn {
  return trpc.portalProve.onchain.bitcoinAccountBalances.useQuery(
    { accounts },
    {
      enabled: options?.enabled,
      // To avoid unnecessarily increasing the rate limit count
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    },
  )
}
