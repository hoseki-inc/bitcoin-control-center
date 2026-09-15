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
  const connectionId = useLedgerStore((state) => state.connectionId)

  const walletsQuery = useQuery<HardwareWallet[], Error>({
    // Scan results belong to this connection, including when two devices share a model.
    queryKey: ['ledger-wallets', connectionId],
    queryFn: async ({ signal }) => {
      const probeRes = await probeLedger(trpcUtils, {
        getBitcoinXpub,
        signal,
        isCurrentConnection: () => {
          const current = useLedgerStore.getState()
          return current.isConnected && current.connectionId === connectionId
        },
      })
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
