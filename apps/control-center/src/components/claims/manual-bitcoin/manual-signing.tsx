import { Button, Stack } from '@chakra-ui/react'
import { Address, Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import type { ClaimId } from '@hoseki/packages/schemas'
import { AccountAccordion, AdvancedFeatureAlert, Alert } from '@hoseki/packages/ui/design-system'
import { BitcoinSigningFormFields } from '@hoseki/packages/ui/design-system/forms/bitcoin-signing-form-fields'
import { formatUsd, toBitcoinAmountDisplayValue } from '@hoseki/packages/ui/utils'
import { type BitcoinInput } from '@hoseki/packages/ui/utils/bitcoin'
import { WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useBitcoinAccountBalances } from '../../../lib/balance/bitcoin-account'
import type { SigningFlowProps } from '../../../lib/claim-flow'
import { trpc } from '../../../trpc'
import type { ChallengeDto, ChallengeMessageDto, ClaimDto } from '../../../trpc/server-types'
import type { ClaimingState } from './shared'

export function ManualSigning({
  claim,
  challengeMessage,
  challenge,
  onExitSigning,
  onSigningComplete,
}: SigningFlowProps): JSX.Element {
  return (
    <Stack gap={4} pt={12}>
      <AdvancedFeatureAlert />

      <BitcoinSigningStep
        claim={claim}
        challengeMessage={challengeMessage}
        challenge={challenge}
        onBack={onExitSigning}
        onSuccess={onSigningComplete}
      />
    </Stack>
  )
}

function BitcoinSigningStep({
  claim,
  challengeMessage,
  challenge,
  onBack,
  onSuccess,
}: {
  claim: ClaimDto
  challengeMessage: ChallengeMessageDto
  challenge: ChallengeDto
  onBack: () => void
  onSuccess: (claimId: ClaimId) => void
}) {
  const [signature, setSignature] = useState<string | null>(null)

  const completeSignedMessageMutation = trpc.portalProve.registry.challengeMessages.complete.useMutation()
  const completeChallengeMutation = trpc.portalProve.registry.challenges.complete.useMutation()

  const claimingStateRes = getClaimingState(claim)
  if (claimingStateRes.isErr()) {
    return <Alert status="error">Invalid account</Alert>
  }
  const claimingState = claimingStateRes.unwrap()

  async function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!claimingState || !signature) {
      return
    }

    try {
      // First, complete the signed message
      await completeSignedMessageMutation.mutateAsync({
        signedMessageId: challengeMessage.signedMessage.id,
        signature,
      })

      // Then complete the challenge
      await completeChallengeMutation.mutateAsync({ challengeId: challenge.id })

      onSuccess(claimingState.claimId)
    } catch (error) {
      toast.error('Failed to complete claim registration')
    }
  }

  return (
    <form onSubmit={handleFormSubmit}>
      <Stack gap={4} pb={WizardFooter.padding}>
        <ManualSigningAccountAccordion bitcoinInput={claimingState?.bitcoinInput} onEditClick={onBack} />
        <BitcoinSigningFormFields
          message={challengeMessage.signedMessage.messageTextToSign}
          address={Address.fromCheckedString(challengeMessage.signedMessage.address)}
          setSignature={setSignature}
        />
      </Stack>
      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Cancel Claim
          </Button>
        }
        rightButton={
          <Button
            type="submit"
            isDisabled={!claimingState || !signature}
            isLoading={completeSignedMessageMutation.isLoading || completeChallengeMutation.isLoading}
          >
            Verify
          </Button>
        }
      />
    </form>
  )
}

function ManualSigningAccountAccordion({
  bitcoinInput,
  onEditClick,
}: {
  bitcoinInput: BitcoinInput | undefined
  onEditClick: () => void
}) {
  const networkAccount = bitcoinInput?.data
  const balancesQuery = useBitcoinAccountBalances(networkAccount ? [networkAccount.toString()] : [], {
    enabled: !!networkAccount?.account,
  })

  const balance = useMemo(() => {
    if (!networkAccount) return { noBalance: 'No account found', btc: null, usd: null }
    if (balancesQuery.isLoading) return { noBalance: 'Loading...', btc: null, usd: null }
    if (balancesQuery.error) return { noBalance: balancesQuery.error.message, btc: null, usd: null }
    if (!balancesQuery.data?.accounts) return { noBalance: 'Balance not found', btc: null, usd: null }

    const balance = balancesQuery.data.accounts.get(networkAccount.toString())
    if (!balance) return { noBalance: 'Balance not found', btc: null, usd: null }

    return {
      noBalance: null,
      btc: toBitcoinAmountDisplayValue(balance.current.toString()),
      usd: balance.usd ? formatUsd(balance.usd.toFixed(2)) : 'n/a',
    }
  }, [networkAccount, balancesQuery])

  if (!bitcoinInput) return null

  return <AccountAccordion bitcoinInput={bitcoinInput} balance={balance} onEditClick={onEditClick} />
}

function getClaimingState(claim: ClaimDto): Result<ClaimingState, Error> {
  const singleSigAccount = SingleSigAccount.fromDescriptor(claim.account)
  if (singleSigAccount.isErr()) {
    return Err(new Error('Invalid account'))
  }

  return Ok({
    claimId: claim.id,
    bitcoinInput: {
      variant: 'singlesig',
      data: new NetworkAccount(Network.fromString(claim.network), singleSigAccount.unwrap()),
      rawInput: claim.account,
      displayName: claim.displayName,
    },
  })
}
