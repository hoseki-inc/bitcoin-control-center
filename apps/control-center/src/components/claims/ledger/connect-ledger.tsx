import { ClaimConnectionWrapper, type HardwareWallet, getLedgerModel } from '@hoseki/packages/ui/wallet-ui'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useToastOnLedgerDisconnect } from '../../../hooks/use-ledger-store'
import { useNavigateToAnExistentOrNewClaim } from '../../../lib/claim-flow'
import { LedgerConnectionInfo } from './ledger-connection-info'
import { LedgerScan } from './ledger-scan'

export function ConnectLedger(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/accounts'
  const [step, setStep] = useState<'step-1-info' | 'step-2-scan'>('step-1-info')
  const navigateToAnExistentOrNewClaim = useNavigateToAnExistentOrNewClaim()

  useToastOnLedgerDisconnect()

  function handleContinue(selectedWallet: HardwareWallet, deviceId: string) {
    navigateToAnExistentOrNewClaim.execute({
      network: 'bitcoin_mainnet',
      account: selectedWallet.account,
      derivationPath: selectedWallet.derivationPath,
      wallet: 'ledger',
      model: getLedgerModel(deviceId),
      displayName: selectedWallet.displayName,
    })
  }

  return (
    <ClaimConnectionWrapper>
      {step === 'step-1-info' && (
        <LedgerConnectionInfo
          onBack={() => {
            void navigate(returnTo)
          }}
          onContinue={() => {
            setStep('step-2-scan')
          }}
        />
      )}

      {step === 'step-2-scan' && (
        <LedgerScan
          isLoadingOnContinue={navigateToAnExistentOrNewClaim.isLoading}
          onContinue={handleContinue}
          onBack={() => {
            setStep('step-1-info')
          }}
          onCancel={() => {
            void navigate(returnTo)
          }}
        />
      )}
    </ClaimConnectionWrapper>
  )
}
