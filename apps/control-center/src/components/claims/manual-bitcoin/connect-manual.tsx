import { Button } from '@chakra-ui/react'
import { BitcoinManualConnect } from '@hoseki/packages/ui/design-system'
import type { BitcoinInput } from '@hoseki/packages/ui/utils/bitcoin'
import { ClaimConnectionWrapper, WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useNavigateToAnExistentOrNewClaim } from '../../../lib/claim-flow'
import { parseNavigationState } from '../../../lib/navigation-state'

export function ConnectManual(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'
  const [bitcoinInput, setBitcoinInput] = useState<BitcoinInput | null>(null)
  const navigateToAnExistentOrNewClaim = useNavigateToAnExistentOrNewClaim()

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    // If input is empty, skip creation
    if (bitcoinInput?.displayName == null || bitcoinInput.displayName === '') {
      return
    }

    navigateToAnExistentOrNewClaim.execute({
      network: bitcoinInput.data.network.toString(),
      account: bitcoinInput.data.account,
      derivationPath: null,
      wallet: null,
      model: null,
      displayName: bitcoinInput.displayName,
    })
  }

  return (
    <ClaimConnectionWrapper>
      <form onSubmit={handleFormSubmit}>
        <BitcoinManualConnect
          bitcoinInput={bitcoinInput}
          setBitcoinInput={setBitcoinInput}
          pt={12}
          pb={WizardFooter.padding}
        />
        <WizardFooter
          leftButton={
            <Button
              variant="outline"
              onClick={() => {
                void navigate(returnTo)
              }}
            >
              Cancel Claim
            </Button>
          }
          rightButton={
            <Button
              type="submit"
              isDisabled={bitcoinInput?.displayName == null || bitcoinInput.displayName === ''}
              isLoading={navigateToAnExistentOrNewClaim.isLoading}
            >
              Add Account
            </Button>
          }
        />
      </form>
    </ClaimConnectionWrapper>
  )
}
