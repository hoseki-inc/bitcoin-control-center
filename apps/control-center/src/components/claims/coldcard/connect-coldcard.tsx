import { Box } from '@chakra-ui/react'
import {
  ClaimConnectionWrapper,
  type ColdcardGenericJsonFile,
  type ColdcardModel,
  type HardwareWallet,
} from '@hoseki/packages/ui/wallet-ui'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useNavigateToAnExistentOrNewClaim } from '../../../lib/claim-flow'
import { RequiredDataMissing } from '../../errors/required-data-missing'
import { ColdcardQrConnectionSteps } from './coldcard-qr-steps'
import { ColdcardConnectionInfo, type ColdcardConnectionMethods, ColdcardIndentification } from './coldcard-steps'

export function ConnectColdcard(): JSX.Element {
  const [wizardStep, setWizardStep] = useState(1)
  const [model, setModel] = useState<ColdcardModel>()
  const [connectionMethod, setConnectionMethod] = useState<keyof typeof ColdcardConnectionMethods>()
  const [coldcardJson, setColdcardJson] = useState<ColdcardGenericJsonFile>()
  const [selectedWallet, setSelectedWallet] = useState<HardwareWallet | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/accounts'
  const goBack = (): void => {
    if (wizardStep === 1) void navigate(returnTo)
    else setWizardStep((prev) => prev - 1)
  }
  const goForward = (): void => setWizardStep((prev) => prev + 1)
  const navigateToAnExistentOrNewClaim = useNavigateToAnExistentOrNewClaim()
  const isQrFlow = model === 'Q'

  function handleContinue(model: ColdcardModel): void {
    if (!selectedWallet) return

    navigateToAnExistentOrNewClaim.execute({
      network: 'bitcoin_mainnet',
      account: selectedWallet.account,
      derivationPath: selectedWallet.derivationPath,
      wallet: 'coldcard',
      model,
      displayName: selectedWallet.displayName ?? 'Coldcard Wallet',
    })
  }

  return (
    <ClaimConnectionWrapper>
      <Box>
        {/* Steps 1-2 are shared: Intro + Model Selection */}
        {/* Step 3 is connection method (MicroSD flow only) */}
        {wizardStep <= (isQrFlow ? 2 : 3) && (
          <ColdcardConnectionInfo
            step={wizardStep}
            onBack={goBack}
            onNext={goForward}
            setModel={setModel}
            setConnectionMethod={setConnectionMethod}
          />
        )}

        {/* QR flow: when model=Q, steps 3-6 map to QR steps 1-4 */}
        {isQrFlow && wizardStep >= 3 && (
          <ColdcardQrConnectionSteps
            step={wizardStep - 2}
            onBack={goBack}
            onNext={goForward}
            coldcardJson={coldcardJson ?? null}
            setColdcardJson={(json) => setColdcardJson(json)}
            selectedWallet={selectedWallet}
            setSelectedWallet={setSelectedWallet}
            isStep4Loading={navigateToAnExistentOrNewClaim.isLoading}
            handleAccountSelectConfirm={handleContinue}
          />
        )}

        {/* MicroSD flow: steps 4-8 for non-Q models */}
        {!isQrFlow &&
          wizardStep >= 4 &&
          wizardStep <= 8 &&
          (!model ? (
            <RequiredDataMissing model={model} />
          ) : (
            <ColdcardIndentification
              step={wizardStep}
              model={model}
              connectionMethod={connectionMethod ?? null}
              onBack={goBack}
              onNext={goForward}
              onSwitchToAirgapping={() => {
                setConnectionMethod('airgapping')
              }}
              coldcardJson={coldcardJson ?? null}
              setColdcardJson={setColdcardJson}
              selectedWallet={selectedWallet}
              setSelectedWallet={setSelectedWallet}
              isStep6Loading={navigateToAnExistentOrNewClaim.isLoading}
              handleAccountSelectConfirm={handleContinue}
            />
          ))}
      </Box>
    </ClaimConnectionWrapper>
  )
}
