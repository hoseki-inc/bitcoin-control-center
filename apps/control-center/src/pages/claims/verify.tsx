import type { ClaimId } from '@hoseki/packages/schemas/prove'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { Navigate } from 'react-router'
import { ConnectBitkey } from '../../components/claims/bitkey/connect-bitkey'
import { ClaimVerificationReceipt } from '../../components/claims/claim-verification-receipt'
import { ConnectColdcard } from '../../components/claims/coldcard/connect-coldcard'
import { ConnectKeystone } from '../../components/claims/keystone/connect-keystone'
import { ConnectLedger } from '../../components/claims/ledger/connect-ledger'
import { ConnectManual } from '../../components/claims/manual-bitcoin/connect-manual'
import { ConnectTrezor } from '../../components/claims/trezor/connect-trezor'
import { UrlParameter, useUrlParameter } from '../../hooks/use-url-parameters'
import { trpc } from '../../trpc'

export function ClaimsVerifyTrezorPage(): JSX.Element {
  return <ConnectTrezor />
}

export function ClaimsVerifyLedgerPage(): JSX.Element {
  return <ConnectLedger />
}

export function ClaimsVerifyColdcardPage(): JSX.Element {
  return <ConnectColdcard />
}

export function ClaimsVerifyKeystonePage(): JSX.Element {
  return <ConnectKeystone />
}

export function ClaimsVerifyBitkeyPage(): JSX.Element {
  return <ConnectBitkey />
}

export function ClaimsVerifyAdvancedPage(): JSX.Element {
  return <ConnectManual />
}

export function ClaimVerificationReceiptPage(): JSX.Element {
  const claimId = useUrlParameter(UrlParameter.claimId)
  if (claimId === null) {
    return <ErrorBanner mt={8} mb={4} message="Invalid claim ID in URL" />
  }

  return <ClaimVerificationReceiptContent claimId={claimId} />
}

function ClaimVerificationReceiptContent({ claimId }: { claimId: ClaimId }): JSX.Element {
  const { data: claim, isError, isFetching } = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId })

  if (isError) {
    return <ErrorBanner mt={8} mb={4} message="Failed to get claim" />
  }

  // Signing marks the cached account stale, so wait for its fresh status before deciding.
  const isVerified = claim?.status === 'verified'
  if (claim && !isVerified && !isFetching) {
    return <Navigate to={`/accounts/${claim.id}`} replace />
  }

  const props =
    claim && isVerified
      ? ({ shouldSetTimeout: true, claim } as const)
      : ({ shouldSetTimeout: false, claim: null } as const)

  return <ClaimVerificationReceipt {...props} />
}
