import { type HardwareWallet, LedgerScanUI } from '@hoseki/packages/ui/wallet-ui'
import { useQuery } from '@tanstack/react-query'
import { useLedgerStore } from '../../../hooks/use-ledger-store'
import { trpc } from '../../../trpc'
import { probeLedger } from './probe-ledger'

export function LedgerScan({
  isLoadingOnContinue,
  onContinue,
  onBack,
  onCancel,
}: {
  isLoadingOnContinue: boolean
  onContinue: (wallet: HardwareWallet, deviceId: string) => void
  onBack: () => void
  onCancel: () => void
}): JSX.Element {
  const trpcUtils = trpc.useUtils()
  const getBitcoinXpub = useLedgerStore((state) => state.getBitcoinXpub)
  const deviceModel = useLedgerStore((state) => state.deviceModel)

  const walletsQuery = useQuery<HardwareWallet[], Error>({
    queryKey: ['ledger-wallets'], // NOTE(Ben) 2025-08-21: This is caching ALL ledger wallets under a single query key. If user has two Ledgers, it'll keep showing the acounts from the first connected device. We should identify the device somehow and add it to the query key.
    queryFn: async () => {
      const probeRes = await probeLedger(trpcUtils, { getBitcoinXpub })
      if (probeRes.isErr()) {
        throw probeRes.unwrapErr()
      }
      return probeRes.unwrap()
    },
    cacheTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return (
    <LedgerScanUI
      isLoadingOnContinue={isLoadingOnContinue}
      onContinue={onContinue}
      onBack={onBack}
      onCancel={onCancel}
      walletsQuery={{
        data: walletsQuery.data ?? [],
        isLoading: walletsQuery.isLoading,
        isError: walletsQuery.isError,
        error: walletsQuery.error ?? null,
      }}
      deviceModel={deviceModel}
    />
  )
}
