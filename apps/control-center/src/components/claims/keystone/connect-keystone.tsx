import { Box } from '@chakra-ui/react'
import { ClaimConnectionWrapper, type HardwareWallet, type KeystoneExportFile } from '@hoseki/packages/ui/wallet-ui'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useNavigateToAnExistentOrNewClaim } from '../../../lib/claim-flow'
import { KeystoneQrConnectionSteps } from './keystone-qr-steps'

export function ConnectKeystone(): JSX.Element {
  const [wizardStep, setWizardStep] = useState(1)
  const [keystoneJson, setKeystoneJson] = useState<KeystoneExportFile>()
  const [selectedWallet, setSelectedWallet] = useState<HardwareWallet | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/accounts'
  const goBack = (): void => {
    if (wizardStep === 1) {
      void navigate(returnTo)
    } else {
      setWizardStep((prev) => prev - 1)
    }
  }
  const goForward = (): void => {
    setWizardStep((prev) => prev + 1)
  }
  const navigateToAnExistentOrNewClaim = useNavigateToAnExistentOrNewClaim()

  function handleContinue(): void {
    if (!selectedWallet) {
      return
    }

    navigateToAnExistentOrNewClaim.execute({
      network: 'bitcoin_mainnet',
      account: selectedWallet.account,
      derivationPath: selectedWallet.derivationPath,
      wallet: 'keystone',
      model: null,
      displayName: selectedWallet.displayName ?? 'Keystone Wallet',
    })
  }

  return (
    <ClaimConnectionWrapper>
      <Box>
        <KeystoneQrConnectionSteps
          step={wizardStep}
          onBack={goBack}
          onNext={goForward}
          keystoneJson={keystoneJson ?? null}
          setKeystoneJson={(json) => {
            setKeystoneJson(json)
          }}
          selectedWallet={selectedWallet}
          setSelectedWallet={setSelectedWallet}
          isStep4Loading={navigateToAnExistentOrNewClaim.isLoading}
          handleAccountSelectConfirm={handleContinue}
        />
      </Box>
    </ClaimConnectionWrapper>
  )
}
