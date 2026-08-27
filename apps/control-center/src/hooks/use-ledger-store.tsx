import { Link } from '@chakra-ui/react'
import { createLedgerStore } from '@hoseki/packages/ui/wallet-ui'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { browserLogger } from '../logger'

export const useLedgerStore = createLedgerStore(browserLogger)

export const useToastOnLedgerDisconnect = (): void => {
  useEffect(() => {
    const unsubscribe = useLedgerStore.subscribe((state, prevState) => {
      if (prevState.isConnected && !state.isConnected) {
        toast.error('Ledger device disconnected', {
          description: 'Plug in your device and click in retry.',
          closeButton: true,
          duration: 30000,
          action: (
            <Link as="button" fontWeight="semibold" onClick={() => window.location.reload()}>
              Retry
            </Link>
          ),
        })
      }
    })

    return unsubscribe
  }, [])
}
