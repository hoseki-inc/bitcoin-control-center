import { Button } from '@chakra-ui/react'
import { BitcoinManualConnect } from '@hoseki/packages/ui/design-system'
import type { BitcoinInput } from '@hoseki/packages/ui/utils/bitcoin'
import { ClaimConnectionWrapper, WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useNavigateToAnExistentOrNewClaim } from '../../../lib/claim-flow'
import { parseNavigationState } from '../../../lib/navigation-state'
import { useXpubScriptBalances } from '../../../pages/claims/verify/use-xpub-script-balances'
import { handOffAccountScan } from '../../../pages/claims/verify/xpub-scan-store'

export function ConnectManual(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'
  const [bitcoinInput, setBitcoinInput] = useState<BitcoinInput | null>(null)
  const [rawInput, setRawInput] = useState('')
  const trimmedRawInput = rawInput.trim()
  const { balances: scriptTypeBalances } = useXpubScriptBalances(trimmedRawInput.startsWith('x') ? trimmedRawInput : '')
  const navigateToAnExistentOrNewClaim = useNavigateToAnExistentOrNewClaim()

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (bitcoinInput?.displayName == null || bitcoinInput.displayName === '') {
      return
    }

    handOffAccountScan(bitcoinInput.data.toString())
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
          scriptTypeBalances={scriptTypeBalances}
          onRawInputChange={setRawInput}
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
              Cancel
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
