import { Button, Text, VStack } from '@chakra-ui/react'
import { ErrorBanner, PageTransition } from '@hoseki/packages/ui/design-system'
import { AppLayout, CheckCircleFilledIcon, Receipt, StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import { convertToOrdinalWords } from '@hoseki/packages/ui/utils'
import { Link, useNavigate, useParams } from 'react-router'
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

  const {
    data: claim,
    isError,
    isLoading,
  } = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId }, { enabled: Boolean(claimId) })

  if (!claimId || isError) {
    return (
      <AppLayout header={<div />}>
        <VStack mt={8} gap={4}>
          <ErrorBanner message="This account verification could not be loaded." />
          <Button as={Link} to="/accounts" variant="outline">
            Back to Accounts
          </Button>
        </VStack>
      </AppLayout>
    )
  }

  if (isLoading) {
    return <Receipt title="Loading key verification…" state="loading" />
  }

  const keystore = claim.keystores.find((k) => k.id === keystoreId)
  if (!keystore) {
    return (
      <AppLayout header={<div />}>
        <VStack mt={8} gap={4}>
          <ErrorBanner message="This key verification could not be loaded." />
          <Button as={Link} to="/accounts" variant="outline">
            Back to Accounts
          </Button>
        </VStack>
      </AppLayout>
    )
  }

  return <KeystoreReceipt shouldSetTimeout keystore={keystore} claim={claim} />
}

export function KeystoreReceipt({ shouldSetTimeout, keystore, claim }: KeystoreReceiptProps): JSX.Element {
  const navigate = useNavigate()

  if (!shouldSetTimeout) {
    return (
      <PageTransition>
        <Receipt title="Loading key verification…" state="loading" />
      </PageTransition>
    )
  }

  const numberOfMissingSignatures = getNumberOfMissingSignatures(claim)
  const description2ndPart =
    numberOfMissingSignatures === 0
      ? 'All required keys are verified.'
      : numberOfMissingSignatures === 1
        ? 'Prove control of one more key to verify this wallet.'
        : `Prove control of ${numberOfMissingSignatures} more keys to verify this wallet.`

  function goBackToMultisigHub() {
    if (!claim) {
      return
    }
    void navigate(`/multisig/${claim.id}`, { replace: true })
  }

  return (
    <PageTransition>
      <Receipt
        title={`${convertToOrdinalWords(getNumberOfSignedMessages(claim))} Key Verified!`}
        state="success"
        onClose={goBackToMultisigHub}
        closeTitle="Back to Multisig"
        content={
          <VStack spacing={8} maxWidth="840px" textAlign="center">
            <Text textStyle="text/md" color="neutral.900">
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
              {numberOfMissingSignatures > 0 ? 'Continue Verification' : 'View Wallet'}
            </Button>
          </VStack>
        }
      />
    </PageTransition>
  )
}
