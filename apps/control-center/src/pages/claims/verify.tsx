import { Button, Stack } from '@chakra-ui/react'
import type { ClaimId } from '@hoseki/packages/schemas/prove'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { AppLayout } from '@hoseki/packages/ui/prove-verify-ui'
import { Link } from 'react-router'
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

export function ClaimsVerifyAdvancedPage(): JSX.Element {
  return <ConnectManual />
}

export function ClaimVerificationReceiptPage(): JSX.Element {
  const claimId = useUrlParameter(UrlParameter.claimId)
  if (claimId === null) {
    return (
      <AppLayout header={<div />}>
        <Stack mt={8} gap={4} align="start">
          <ErrorBanner message="Invalid claim ID in URL" />
          <Button as={Link} to="/accounts" variant="outline">
            Back to Accounts
          </Button>
        </Stack>
      </AppLayout>
    )
  }

  return <ClaimVerificationReceiptContent claimId={claimId} />
}

function ClaimVerificationReceiptContent({ claimId }: { claimId: ClaimId }): JSX.Element {
  const { data: claim, isError } = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claimId })

  if (isError) {
    return (
      <AppLayout header={<div />}>
        <Stack mt={8} gap={4} align="start">
          <ErrorBanner message="This account verification could not be loaded." />
          <Button as={Link} to="/accounts" variant="outline">
            Back to Accounts
          </Button>
        </Stack>
      </AppLayout>
    )
  }

  const props = claim
    ? ({ shouldSetTimeout: true, claim } as const)
    : ({ shouldSetTimeout: false, claim: null } as const)

  return <ClaimVerificationReceipt {...props} />
}
