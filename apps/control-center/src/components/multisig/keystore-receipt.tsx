import { Icon } from '@chakra-ui/react'
import type { ClaimId } from '@hoseki/packages/schemas/prove'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { RoundKeyIcon } from '@hoseki/packages/ui/prove-verify-ui/icons'
import { capitalize, convertToOrdinalWords } from '@hoseki/packages/ui/utils'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { UrlParameter, useUrlParameter } from '../../hooks/use-url-parameters'
import { trpc } from '../../trpc'
import type { ClaimDto, KeystoreDto } from '../../trpc/server-types'
import { getNumberOfMissingSignatures, getNumberOfSignedMessages } from '../../utils/multisig-utils'
import { type ConnectionHero, ConnectionPending, ConnectionSuccess } from '../claims/connection-success'
import { getWalletImage } from '../claims/wallet-image-from-known-model'

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
    return <ErrorBanner mt={8} mb={4} message="Invalid claim ID in URL" />
  }

  return <KeystoreReceiptContent claimId={claimId} />
}

function KeystoreReceiptContent({ claimId }: { claimId: ClaimId }): JSX.Element {
  const { keystoreId } = useParams()
  const { data: claim, isLoading, isError } = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId })

  if (isError) {
    return <ErrorBanner mt={8} mb={4} message="Failed to get claim" />
  }

  // Keep showing the pending receipt until the claim loads, rather than reporting a missing keystore.
  if (isLoading) {
    return <KeystoreReceipt shouldSetTimeout={false} keystore={null} claim={null} />
  }

  const keystore = claim.keystores.find((k) => k.id === keystoreId)
  if (!keystore) {
    return <ErrorBanner mt={8} mb={4} message="Failed to get keystore" />
  }

  return <KeystoreReceipt shouldSetTimeout keystore={keystore} claim={claim} />
}

export function KeystoreReceipt({ shouldSetTimeout, keystore, claim }: KeystoreReceiptProps): JSX.Element {
  const [isPending, setIsPending] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (!shouldSetTimeout) {
      return
    }
    const timeout = setTimeout(() => {
      setIsPending(false)
    }, 1700)
    return () => {
      clearTimeout(timeout)
    }
  }, [shouldSetTimeout])

  const hero = keystore ? keystoreHero(keystore) : undefined
  if (isPending || !claim) {
    return <ConnectionPending title="Verifying Your Key..." hero={hero} />
  }

  const numberOfMissingSignatures = getNumberOfMissingSignatures(claim)
  const goBackToMultisigHub = () => {
    void navigate(`/multisig/${claim.id}`, { replace: true })
  }

  return (
    <ConnectionSuccess
      hero={hero}
      title={`${capitalize(convertToOrdinalWords(getNumberOfSignedMessages(claim)))} Key Verified!`}
      subtitle={
        numberOfMissingSignatures === 1
          ? 'Prove control of one more key to finish verifying this multisig.'
          : `Prove control of ${numberOfMissingSignatures} more keys to finish verifying this multisig.`
      }
      primary={{ label: 'Verify Next Key', onClick: goBackToMultisigHub }}
      onClose={goBackToMultisigHub}
      closeTitle="Back to Multisig"
    />
  )
}

/** The key's device, or a key on a tile when Control Center has no picture of it. */
function keystoreHero(keystore: KeystoreDto): ConnectionHero {
  const image = getWalletImage(keystore.wallet, keystore.model ?? '')
  if (image) {
    return { photo: image.href, alt: image.alt }
  }
  return {
    icon: <Icon as={RoundKeyIcon} fill="neutral.400" color2="shades.0" stroke="none" boxSize="48px" />,
  }
}
