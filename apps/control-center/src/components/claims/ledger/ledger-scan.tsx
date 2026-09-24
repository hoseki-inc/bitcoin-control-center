import { type HardwareWallet, LedgerScanUI } from '@hoseki/packages/ui/wallet-ui'
import { useQuery } from '@tanstack/react-query'
import { useLedgerStore } from '../../../hooks/use-ledger-store'
import { trpc } from '../../../trpc'
import { probeLedger } from './probe-ledger'

interface LedgerScanProps {
  isLoadingOnContinue: boolean
  onContinue: (wallet: HardwareWallet, deviceId: string) => void
  onBack: () => void
  onCancel: () => void
}

export function LedgerScan(props: LedgerScanProps): JSX.Element {
  const balanceApi = trpc.useUtils()
  return <LedgerAccountScan {...props} balanceApi={balanceApi} ledgerStore={useLedgerStore} />
}

export function LedgerAccountScan({
  isLoadingOnContinue,
  onContinue,
  onBack,
  onCancel,
  balanceApi,
  ledgerStore,
  ScanView = LedgerScanUI,
}: LedgerScanProps & {
  balanceApi: Parameters<typeof probeLedger>[0]
  ledgerStore: typeof useLedgerStore
  ScanView?: typeof LedgerScanUI
}): JSX.Element {
  const getBitcoinXpub = ledgerStore((state) => state.getBitcoinXpub)
  const deviceModel = ledgerStore((state) => state.deviceModel)
  const connectionId = ledgerStore((state) => state.connectionId)

  const walletsQuery = useQuery<HardwareWallet[], Error>({
    // Scan results belong to this connection, including when two devices share a model.
    queryKey: ['ledger-wallets', connectionId],
    queryFn: async ({ signal }) => {
      const probeRes = await probeLedger(balanceApi, {
        getBitcoinXpub,
        signal,
        isCurrentConnection: () => {
          const current = ledgerStore.getState()
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
    <ScanView
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
