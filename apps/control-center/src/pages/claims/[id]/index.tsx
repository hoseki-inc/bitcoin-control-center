import { ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import { ClaimDetails } from '../../../components/claims/claim-details/claim-details'
import { UrlParameter, useUrlParameter } from '../../../hooks/use-url-parameters'
import { trpc } from '../../../trpc'

export function ClaimDetailsPage(): JSX.Element {
  const claimId = useUrlParameter(UrlParameter.claimId)

  const {
    isLoading,
    error,
    data: claim,
  } = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId }, { enabled: Boolean(claimId) })

  if (isLoading) {
    return <Spinner fullPage size="xl" />
  }
  if (!claimId || error) {
    return <ErrorBanner mt={8} mb={4} message={`An error occurred while loading the claim. ${error?.message ?? ''}`} />
  }

  return <ClaimDetails claim={claim} />
}
