import type { ClaimId } from '@hoseki/packages/schemas/prove'
import { ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import { ClaimDetails } from '../../../components/claims/claim-details/claim-details'
import { UrlParameter, useUrlParameter } from '../../../hooks/use-url-parameters'
import { trpc } from '../../../trpc'

export function ClaimDetailsPage(): JSX.Element {
  const claimId = useUrlParameter(UrlParameter.claimId)
  if (claimId === null) {
    return <ErrorBanner mt={8} mb={4} message="Invalid claim ID in URL" />
  }

  return <ClaimDetailsContent claimId={claimId} />
}

function ClaimDetailsContent({ claimId }: { claimId: ClaimId }): JSX.Element {
  const { isLoading, error, data: claim } = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId })

  if (isLoading) {
    return <Spinner fullPage size="xl" />
  }
  if (error) {
    return <ErrorBanner mt={8} mb={4} message={`An error occurred while loading the claim. ${error.message}`} />
  }

  return <ClaimDetails claim={claim} />
}
