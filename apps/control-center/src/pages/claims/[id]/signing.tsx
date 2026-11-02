import type { ClaimId } from '@hoseki/packages/schemas/prove'
import { Alert, Spinner } from '@hoseki/packages/ui/design-system'
import { ClaimConnectionWrapper } from '@hoseki/packages/ui/wallet-ui'
import { Navigate, useNavigate } from 'react-router'
import { ColdcardSigning } from '../../../components/claims/coldcard/coldcard-signing'
import { KeystoneSigning } from '../../../components/claims/keystone/keystone-signing'
import { LedgerSigning } from '../../../components/claims/ledger/ledger-signing'
import { ManualSigning } from '../../../components/claims/manual-bitcoin/manual-signing'
import { TrezorSigning } from '../../../components/claims/trezor/trezor-signing'
import { UrlParameter, useUrlParameter } from '../../../hooks/use-url-parameters'
import type { SigningFlowProps } from '../../../lib/claim-flow'
import { trpc } from '../../../trpc'

export function SinglesigSigningPage(): JSX.Element {
  return (
    <ClaimConnectionWrapper>
      <SinglesigSigning />
    </ClaimConnectionWrapper>
  )
}

function SinglesigSigning(): JSX.Element {
  const claimId = useUrlParameter(UrlParameter.claimId)
  if (claimId === null) {
    return <Alert status="error">Invalid claim ID in URL</Alert>
  }

  return <SinglesigSigningContent claimId={claimId} />
}

function SinglesigSigningContent({ claimId }: { claimId: ClaimId }): JSX.Element {
  const navigate = useNavigate()

  const claimQuery = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId })
  const claim = claimQuery.data
  const messageQuery = trpc.portalProve.registry.getOrCreateSinglesigChallengeMessage.useQuery(
    {
      network: claim?.network ?? 'bitcoin_mainnet',
      account: claim?.account ?? '',
    },
    {
      enabled: !!claim && !claim.isArchived,
    },
  )
  const message = messageQuery.data

  if (claimQuery.isLoading) {
    return <Spinner fullPage size="xl" />
  }

  if (claimQuery.isError || !claim) {
    return <Alert status="error">Failed to get claim</Alert>
  }

  if (claim.isArchived) {
    return <Navigate to="/accounts#archived" replace />
  }

  if (messageQuery.isLoading) {
    return <Spinner fullPage size="xl" />
  }

  if (messageQuery.isError) {
    return <Alert status="error">Failed to get message</Alert>
  }

  if (!message) {
    return <Alert status="error">Message not found</Alert>
  }

  const firstKeystore = claim.keystores[0]
  if (!firstKeystore) {
    return <Alert status="error">No keystore found</Alert>
  }

  const commonProps: SigningFlowProps = {
    claim,
    keystore: firstKeystore,
    challenge: message.challenge,
    challengeMessage: message.challengeMessage,
    onExitSigning: () => {
      void navigate(-1)
    },
    onSigningComplete: () => {
      void navigate('/accounts/verify/receipt/' + claim.id)
    },
  } as const

  switch (firstKeystore.wallet) {
    case 'coldcard':
      return <ColdcardSigning {...commonProps} />
    case 'keystone':
      return <KeystoneSigning {...commonProps} />
    case 'ledger':
      return <LedgerSigning {...commonProps} />
    case 'trezor':
      return <TrezorSigning {...commonProps} />
    // Bitkey accounts are multisig and can't be verified, so they never reach singlesig signing.
    case 'bitkey':
    case null:
    default:
      return <ManualSigning {...commonProps} />
  }
}
