import { Button, HStack, Stack, Text } from '@chakra-ui/react'
import { Alert, ErrorBanner, PageTransition, Spinner } from '@hoseki/packages/ui/design-system'
import { WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import type { SupportedHardwareWallet } from '@hoseki/packages/wallet'
import { InfoIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AbandonClaimButton } from '../../../components/claims/claim-details/delete-claim-modal'
import { ResumeMultisigKeyFlow } from '../../../components/claims/resume-flow'
import {
  type IndicatorKeystoreWithModel,
  useMultisigPageWrapperContext,
} from '../../../components/multisig/multisig-page-wrapper'
import { SelectWalletType } from '../../../components/multisig/multisig-select-wallet-type'
import { browserLogger } from '../../../logger'
import { trpc } from '../../../trpc'
import type { ClaimDto } from '../../../trpc/server-types'
import { getThreshold } from '../../../utils/multisig-utils'

export function MultisigDetailsPage(): JSX.Element {
  const { claim, indicatorKeystores, expandedKeystore } = useMultisigPageWrapperContext()

  useSyncKeystoreSearchParam({ keystores: indicatorKeystores })

  return (
    <Stack py={4}>
      {/* passing key here forces the animation to run */}
      <PageTransition key={expandedKeystore?.id ?? null}>
        <ConnectWallets claim={claim} expandedKeystore={expandedKeystore} />
      </PageTransition>
    </Stack>
  )
}

function ConnectWallets({
  claim,
  expandedKeystore,
}: {
  claim: ClaimDto
  expandedKeystore: IndicatorKeystoreWithModel | null
}) {
  const navigate = useNavigate()
  const [challengeError, setChallengeError] = useState<string | null>(null)

  const trpcUtils = trpc.useUtils()
  const createChallenge = trpc.portalProve.registry.challenges.create.useMutation()

  async function handleNextSigningDeviceClick(signingDevice: SupportedHardwareWallet) {
    if (!expandedKeystore) {
      return
    }
    if (claim.latestChallenge) {
      void navigate(`/multisig/${claim.id}/connect/${signingDevice}/${expandedKeystore.id}`)
      return
    }

    try {
      await createChallenge.mutateAsync({ claimId: claim.id })
      await trpcUtils.portalProve.registry.claims.get.byId.invalidate()
      void navigate(`/multisig/${claim.id}/connect/${signingDevice}/${expandedKeystore.id}`)
    } catch (error) {
      browserLogger.error(error, 'Error creating challenge')
      setChallengeError('Error creating challenge')
    }
  }

  const threshold = getThreshold(claim.account)
  const kLength = claim.keystores.length
  const canAbandon = claim.status === 'pending'

  const signedMessagesLength = claim.latestChallenge?.messages.filter((k) => k.signed).length ?? 0

  return (
    <Stack spacing={4}>
      {challengeError != null && challengeError !== '' && <ErrorBanner mb={4} message={challengeError} />}

      {!expandedKeystore ? (
        <Spinner fullPage size="xl" isLazy />
      ) : expandedKeystore.status === 'pending' ? (
        <>
          <SelectWalletType
            onConnectionTypeClick={(device) => {
              void handleNextSigningDeviceClick(device)
            }}
            signedMessagesLength={signedMessagesLength}
          />
          <Alert bgColor="neutral.50">
            <HStack>
              <InfoIcon size={20} />
              <Text color="neutral.600">
                {threshold < kLength
                  ? `You only need to sign with ${threshold} of your ${kLength} keys to complete verification.`
                  : `You need to sign with all ${kLength} of your keys to complete verification.`}
              </Text>
            </HStack>
          </Alert>
          {canAbandon && <WizardFooter rightButton={<AbandonClaimButton claim={claim} />} />}
        </>
      ) : (
        <>
          <ResumeMultisigKeyFlow
            wallet={expandedKeystore.wallet}
            model={expandedKeystore.model}
            keystoreId={expandedKeystore.id}
          />
          <WizardFooter
            rightButton={
              <HStack>
                {canAbandon && <AbandonClaimButton claim={claim} />}
                <Button
                  onClick={() => {
                    void navigate(`/multisig/${claim.id}/signing/${expandedKeystore.wallet}/${expandedKeystore.id}`)
                  }}
                >
                  Continue
                </Button>
              </HStack>
            }
          />
        </>
      )}
    </Stack>
  )
}

/**
 * When in the details page (aka the hub), put the keystoreId that should be expanded in the url.
 *
 * Vini: This was necessary because there were situations where the user was redirected to the details page
 * without the keystoreId in the url, which is inconsistent since keystoreId is now used to determine which
 * keystore is expanded in the hub page. So if the user ir coming from /claims page, this will immediately
 * put the keystoreId in the url. This goes in the direction of making the URL the source of truth for the
 * UI state.
 *
 */
function useSyncKeystoreSearchParam({ keystores }: { keystores: IndicatorKeystoreWithModel[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    // If the `?keystoreId=re_ks_...` is in the url, keep it.
    if (searchParams.has('keystoreId')) {
      return
    }

    // 1. Expand the first identified keystore found.
    // 2. If none, expand the first pending keystore found.
    // 3. Otherwise, don't expand any keystore.
    const ks = keystores.find((k) => k.status === 'identified') ?? keystores.find((k) => k.status === 'pending') ?? null

    if (ks) {
      const newSearchParameters: URLSearchParams = new URLSearchParams()
      newSearchParameters.set('keystoreId', ks.id)
      setSearchParams(newSearchParameters, { replace: true })
    }
  }, [keystores, searchParams, setSearchParams, navigate])
}
