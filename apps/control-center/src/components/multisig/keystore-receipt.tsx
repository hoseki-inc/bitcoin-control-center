import { Button, Text, VStack } from '@chakra-ui/react'
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
  const { keystoreId } = useParams()
  const claimId = useUrlParameter(UrlParameter.claimId)

  const { data: claim, isError } = trpc.portalProve.registry.claims.get.byId.useQuery(
    { id: claimId ?? '' },
    { enabled: Boolean(claimId) },
  )

  if (!claimId || isError) {
    return (
      <AppLayout header={<div />}>
        <ErrorBanner mt={8} mb={4} message="Failed to get claim" />
      </AppLayout>
    )
  }

  const keystore = claim?.keystores.find((k) => k.id === keystoreId)
  if (!keystore) {
    return (
      <AppLayout header={<div />}>
        <ErrorBanner mt={8} mb={4} message="Failed to get keystore" />
      </AppLayout>
    )
  }

  const props = claim
    ? ({ shouldSetTimeout: true, keystore, claim } as const)
    : ({ shouldSetTimeout: false, keystore: null, claim: null } as const)

  return <KeystoreReceipt {...props} />
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

  if (!claim || !keystore) {
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
              You've successfully proven control of this key in your multisig setup. {description2ndPart}
            </Text>
            <VStack spacing={4}>
              {keystore.model && <WalletImageFromKnownModel wallet={keystore.wallet} model={keystore.model} />}
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
