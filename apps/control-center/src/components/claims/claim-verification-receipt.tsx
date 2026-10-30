import { Icon } from '@chakra-ui/react'
import { StatusBadge, getBadgeConfigForClaim } from '@hoseki/packages/ui/prove-verify-ui'
import { RoundKeyIcon } from '@hoseki/packages/ui/prove-verify-ui/icons'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useGetClaimBalance } from '../../lib/balances'
import { clearFlowSource, getFlowSource } from '../../lib/flow-tracker'
import type { ClaimDto } from '../../trpc/server-types'
import { MultisigKeys } from './account-type-media'
import { type ConnectionHero, ConnectionPending, ConnectionSuccess } from './connection-success'
import { getWalletImage, getWalletName } from './wallet-image-from-known-model'

type ClaimVerificationReceiptProps =
  | {
      shouldSetTimeout: false
      claim: null
    }
  | {
      shouldSetTimeout: true
      claim: ClaimDto
    }

export function ClaimVerificationReceipt({ shouldSetTimeout, claim }: ClaimVerificationReceiptProps): JSX.Element {
  const [isPending, setIsPending] = useState(true)
  const navigate = useNavigate()

  const balance = useGetClaimBalance(claim?.id ?? null, { enabled: claim?.id != null && claim.id.length > 0 })

  const flowSource = getFlowSource()
  const isStatementFlow = flowSource?.type === 'statement'

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

  const handleNavigation = (path: string) => {
    clearFlowSource()
    void navigate(path)
  }

  if (!claim) {
    return <ConnectionPending title="Verifying Your Wallet..." />
  }

  const name = claimName(claim)
  if (isPending) {
    return <ConnectionPending title={`Verifying Your ${name}...`} hero={claimHero(claim)} />
  }

  const badge = getBadgeConfigForClaim(claim.status)
  const viewAccount = () => {
    handleNavigation(`/accounts/${claim.id}`)
  }

  return (
    <ConnectionSuccess
      hero={claimHero(claim)}
      title={`${name} Verified!`}
      subtitle="Its balance and history now show in Control Center, ready for your statements."
      balance={balance}
      badge={<StatusBadge status={badge.status} label={badge.label} icon={badge.icon} size="sm" />}
      primary={{
        label: isStatementFlow ? 'Complete Statement' : 'Generate Statement',
        onClick: () => {
          handleNavigation('/statements/create')
        },
      }}
      secondary={{ label: `View ${name}`, onClick: viewAccount }}
      onClose={viewAccount}
      closeTitle={`View ${name}`}
    />
  )
}

/** What the screen calls the account: its device's brand, "Multisig", or "Wallet" for an unknown device. */
function claimName(claim: ClaimDto): string {
  if (claim.keystores.length > 1) {
    return 'Multisig'
  }
  return getWalletName(claim.keystores[0]?.wallet ?? null) ?? 'Wallet'
}

function claimHero(claim: ClaimDto): ConnectionHero {
  if (claim.keystores.length > 1) {
    return { picture: <MultisigKeys size="56px" /> }
  }
  const keystore = claim.keystores[0]
  const image = keystore ? getWalletImage(keystore.wallet, keystore.model ?? '') : null
  if (image) {
    return { photo: image.href, alt: image.alt }
  }
  return {
    icon: <Icon as={RoundKeyIcon} fill="neutral.400" color2="shades.0" stroke="none" boxSize="48px" />,
  }
}
