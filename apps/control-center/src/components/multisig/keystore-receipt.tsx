import { Button, Text, VStack } from '@chakra-ui/react'
import type { ClaimId } from '@hoseki/packages/schemas/prove'
import { ErrorBanner, PageTransition } from '@hoseki/packages/ui/design-system'
import { AppLayout, CheckCircleFilledIcon, Receipt, StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import { convertToOrdinalWords } from '@hoseki/packages/ui/utils'
import { useEffect, useState } from 'react'
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks'
import { useNavigate, useParams } from 'react-router'
import { UrlParameter, useUrlParameter } from '../../hooks/use-url-parameters'
import { trpc } from '../../trpc'
import type { ClaimDto, KeystoreDto } from '../../trpc/server-types'
import { getNumberOfMissingSignatures, getNumberOfSignedMessages } from '../../utils/multisig-utils'
import { WalletImageFromKnownModel } from '../claims/wallet-image-from-known-model'

type KeystoreReceiptProps =
  | {
      shouldSetTimeout: false
      keystore: null
      claim: null
    }
  | {
      shouldSetTimeout: true
      keystore: KeystoreDto
      claim: ClaimDto
    }

export function KeystoreReceiptPage(): JSX.Element {
  const claimId = useUrlParameter(UrlParameter.claimId)
  if (claimId === null) {
    return (
      <AppLayout header={<div />}>
        <ErrorBanner mt={8} mb={4} message="Invalid claim ID in URL" />
      </AppLayout>
    )
  }

  return <KeystoreReceiptContent claimId={claimId} />
}

function KeystoreReceiptContent({ claimId }: { claimId: ClaimId }): JSX.Element {
  const { keystoreId } = useParams()
  const { data: claim, isLoading, isError } = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId })

  if (isError) {
    return (
      <AppLayout header={<div />}>
        <ErrorBanner mt={8} mb={4} message="Failed to get claim" />
      </AppLayout>
    )
  }

  // Keep showing the pending receipt until the claim loads, rather than reporting a missing keystore.
  if (isLoading) {
    return <KeystoreReceipt shouldSetTimeout={false} keystore={null} claim={null} />
  }

  const keystore = claim?.keystores.find((k) => k.id === keystoreId)
  if (!claim || !keystore) {
    return (
      <AppLayout header={<div />}>
        <ErrorBanner mt={8} mb={4} message="Failed to get keystore" />
      </AppLayout>
    )
  }

  return <KeystoreReceipt shouldSetTimeout keystore={keystore} claim={claim} />
}

export function KeystoreReceipt({ shouldSetTimeout, keystore, claim }: KeystoreReceiptProps): JSX.Element {
  const [isPending, setIsPending] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (shouldSetTimeout) {
      setTimeout(() => {
        setIsPending(false)
      }, 1700)
    }
  }, [shouldSetTimeout])

  if (isPending) {
    return (
      <PageTransition>
        <Receipt title="Validating key..." state="loading" />
      </PageTransition>
    )
  }

  if (!claim) {
    return (
      <AppLayout header={<div />}>
        <ErrorBanner mt={8} mb={4} message="Failed to get claim" />
      </AppLayout>
    )
  }

  const numberOfMissingSignatures = getNumberOfMissingSignatures(claim)
  const description2ndPart =
    numberOfMissingSignatures === 1
      ? 'Prove control of one more key to finish validating your multisig claim!'
      : `Prove control of ${numberOfMissingSignatures} more keys to finish validating your multisig claim!`

  function goBackToMultisigHub() {
    if (!claim) {
      return
    }
    void navigate(`/multisig/${claim.id}`, { replace: true })
  }

  return (
    <PageTransition>
      <Fireworks autorun={{ speed: 2, duration: 5_000, delay: 500 }} />
      <Receipt
        title={`${convertToOrdinalWords(getNumberOfSignedMessages(claim))} Key Verified!`}
        state="success"
        onClose={goBackToMultisigHub}
        closeTitle="Back to Multisig"
        content={
          <VStack spacing={8} maxWidth="840px" textAlign="center">
            <Text textStyle="text/2xl" color="neutral.900">
              You&apos;ve successfully proven control of this key in your multisig setup. {description2ndPart}
            </Text>
            <VStack spacing={4}>
              {keystore.model != null && keystore.model !== '' && (
                <WalletImageFromKnownModel wallet={keystore.wallet} model={keystore.model} />
              )}
              <Text textStyle="text/md" fontWeight="medium" color="neutral.900">
                {keystore.label}
              </Text>
              <StatusBadge status="success" label="Verified" icon={CheckCircleFilledIcon} size="md" />
            </VStack>
            <Button variant="primary" onClick={goBackToMultisigHub}>
              Verify Next Key
            </Button>
          </VStack>
        }
      />
    </PageTransition>
  )
}
