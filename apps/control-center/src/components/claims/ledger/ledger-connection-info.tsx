import { LedgerConnectionInfoUI } from '@hoseki/packages/ui/wallet-ui'
import { useMutation } from '@tanstack/react-query'
import { useLedgerStore } from '../../../hooks/use-ledger-store'
import { getDesktopLedger } from '../../../lib/desktop-ledger'
import { browserLogger } from '../../../logger'
import { DesktopLedgerConnection } from './desktop-ledger-connection'

export function LedgerConnectionInfo({
  onBack,
  onContinue,
}: {
  onBack?: () => void
  onContinue: () => void
}): JSX.Element {
  const reset = useLedgerStore((state) => state.reset)
  const init = useLedgerStore((state) => state.init)
  const isInitialized = useLedgerStore((state) => state.isInitialized)

  const connectLedger = useMutation({
    mutationFn: async () => {
      if (isInitialized) {
        await reset()
      }
      await init()
    },
    onSuccess: onContinue,
    onError(error) {
      browserLogger.error(error, 'Ledger connection error')
    },
  })

  const desktopLedger = getDesktopLedger()
  if (desktopLedger) return <DesktopLedgerConnection bridge={desktopLedger} onBack={onBack} onContinue={onContinue} />

  return (
    <LedgerConnectionInfoUI
      onBack={onBack}
      onContinue={() => connectLedger.mutate()}
      isLoading={connectLedger.isLoading}
      error={connectLedger.error as Error | null}
    />
  )
}
