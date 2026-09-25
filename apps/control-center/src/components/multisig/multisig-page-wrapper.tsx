import { Button, Stack } from '@chakra-ui/react'
import { ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import type { Keystore as IndicatorKeystore } from '@hoseki/packages/ui/prove-verify-ui/claims/keystores-status-indicator'
import { Navigate, Outlet, useOutletContext, useParams, useSearchParams } from 'react-router'
import { UrlParameter, useUrlParameter } from '../../hooks/use-url-parameters'
import { getKeystoreStatus } from '../../lib/multisig/keystore'
import { trpc } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import { ClaimTopBar } from '../claims/claim-top-bar'
import { MultisigHeader, isUserOnMultisigDetailsPage } from './multisig-header'

export type IndicatorKeystoreWithModel = IndicatorKeystore & { model: string | null }

type ContextType = {
  claim: ClaimDto
  indicatorKeystores: IndicatorKeystoreWithModel[]
  expandedKeystore: IndicatorKeystoreWithModel | null
}

export function MultisigPageWrapper(): JSX.Element {
  const claimId = useUrlParameter(UrlParameter.claimId)
  const { keystoreId } = useParams<{ keystoreId: string }>()
  const [searchParams] = useSearchParams()

  const {
    isLoading,
    isFetching,
    refetch,
    error,
    data: claim,
  } = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId }, { enabled: Boolean(claimId) })

  if (!claimId) {
    return <ErrorBanner mt={8} mb={4} message="Invalid wallet ID" />
  }
  if (isLoading) {
    return <Spinner fullPage />
  }
  if (error) {
    return (
      <Stack mt={8} spacing={4} align="start">
        <ErrorBanner message={`An error occurred while loading the claim: ${error.message}`} />
        <Button
          isLoading={isFetching}
          onClick={() => {
            void refetch()
          }}
        >
          Retry
        </Button>
      </Stack>
    )
  }
  if (claim.isArchived) {
    return <Navigate to="/accounts#archived" replace />
  }

  const indicatorKeystores = getIndicatorKeystores(claim)
  // determine which keystore should be expanded based on the url
  const keystoreIdFromUrl = searchParams.get('keystoreId') ?? keystoreId
  const expandedKeystore = indicatorKeystores.find((k) => k.id === keystoreIdFromUrl) ?? null

  return (
    <Stack py={6} spacing={2}>
      {isUserOnMultisigDetailsPage(window.location.pathname) && <ClaimTopBar claim={claim} mb={2} />}
      <MultisigHeader
        claim={claim}
        indicatorKeystores={indicatorKeystores}
        expandedKeystoreId={expandedKeystore?.id ?? null}
      />
      <Outlet
        context={{
          claim,
          indicatorKeystores,
          expandedKeystore,
        }}
      />
    </Stack>
  )
}

export function useMultisigPageWrapperContext(): ContextType {
  const context = useOutletContext<ContextType | null | undefined>()
  if (!context) {
    throw new Error('usePageWrapperContext must be used within a MultisigPageWrapper')
  }
  return context
}

/**
 * Transforms keystores from MultisigWallet to the indicator keystores.
 */
export function getIndicatorKeystores(claim: ClaimDto): IndicatorKeystoreWithModel[] {
  const keystores: IndicatorKeystoreWithModel[] = []
  for (const keystore of claim.keystores) {
    const status = getKeystoreStatus(keystore, claim)

    const common = {
      id: keystore.id,
      name: keystore.label,
      model: keystore.model,
    } as const

    let k: IndicatorKeystoreWithModel
    switch (status) {
      case 'pending':
        k = {
          ...common,
          status,
          wallet: null,
          model: null,
        }
        break
      case 'identified':
      case 'verified':
        k = {
          ...common,
          status,
          wallet: keystore.wallet,
          model: keystore.model,
        }
        break
    }

    keystores.push(k)
  }

  return keystores
}
