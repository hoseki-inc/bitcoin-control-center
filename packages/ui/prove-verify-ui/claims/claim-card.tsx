import { HStack, Stack, type StackProps, Text, forwardRef } from '@chakra-ui/react'
import type { BalanceWithStatus } from '@hoseki/packages/lib/balance'
import type { ClaimStatus } from '@hoseki/packages/schemas/prove'
import type { SupportedHardwareWallet } from '@hoseki/packages/wallet'
import { getSupportedHardwareWalletLogoPath } from '@hoseki/packages/wallet'
import { TextSkeleton } from '../../design-system/loading/loading'
import { CheckCircleFilledIcon, StatusBadge, getBadgeConfigForClaim } from '../../prove-verify-ui'
import { AlertTriangleFilledIcon } from '../../prove-verify-ui/icons'
import { formatSatsToBtc, formatUsd } from '../../utils'
import { KeystoreAvatar, type KeystoreAvatarProps } from './keystore-avatar'
import { keyIcon } from './keystores-status-indicator'

export interface ClaimCardKeystore {
  id: string
  wallet: SupportedHardwareWallet | null
  isVerified?: boolean // Optional because only used for Multisig
}

export type ClaimCardProps = {
  officialName: string
  displayName: string
  status: ClaimStatus
  keystores: ClaimCardKeystore[]
  threshold?: number
  balance: BalanceWithStatus
  isSelected?: boolean
  onClick?: () => void
} & StackProps

// forwardRef is used here to make the component work with the Link component from react-router
export const ClaimCard = forwardRef<ClaimCardProps, 'div'>(
  (
    {
      officialName,
      displayName,
      status,
      keystores,
      threshold = 1, // Default to SingleSig. Only Multisig needs to pass the threshold in.
      balance,
      isSelected,
      onClick: _onClick,
      ...props
    },
    ref,
  ) => {
    const { status: badgeStatus, label } = getBadgeConfigForClaim(status)

    return (
      <Stack
        position="relative"
        gap={1}
        textAlign="center"
        borderWidth="1px"
        borderRadius="md"
        borderColor={isSelected === true ? 'primary.600' : 'neutral.200'}
        p={2}
        pb={6}
        bg={isSelected === true ? 'primary.50' : 'white'}
        transition="all 0.2s"
        ref={ref}
        {...props}
      >
        <HStack>
          {keystores.length > 1 && (
            <StatusBadge
              status="neutral"
              label={`${threshold} of ${keystores.length}`}
              size="sm"
              textTransform="none"
            />
          )}
          <StatusBadge status={badgeStatus} label={label} size="sm" ml="auto" />
        </HStack>

        <ClaimCardKeystores keystores={keystores} alt={displayName} mx="auto" status={status} />

        <Stack gap={1} mx={4}>
          <Text textStyle="label/md" fontWeight="medium" color="neutral.600">
            {officialName}
          </Text>
          <Text textStyle="label/md" fontWeight="medium" color="neutral.600" isTruncated>
            {displayName}
          </Text>
          <Stack gap={0}>
            <Text textStyle="label/md" fontWeight="medium" color="neutral.900">
              {renderBalance(balance)}
            </Text>
            <Text textStyle="label/md" fontWeight="medium" color="success.600" _empty={{ display: 'none' }}>
              {renderUsdAmount(balance)}
            </Text>
          </Stack>
        </Stack>
      </Stack>
    )
  },
)

ClaimCard.displayName = 'ClaimCard'

function renderBalance(balance: BalanceWithStatus): React.ReactNode {
  if (balance.status === 'loading') {
    return <TextSkeleton width="8em" />
  }
  if (balance.status === 'fail') {
    return 'n/a'
  }
  return `${formatSatsToBtc(balance.value.current.toString())} BTC`
}

function renderUsdAmount(balance: BalanceWithStatus): React.ReactNode {
  if (balance.status === 'loading') {
    return <TextSkeleton width="5em" />
  }
  if (balance.status === 'fail' || balance.value.usd === null) {
    return null
  }
  return formatUsd(balance.value.usd.toFixed(2))
}

interface ClaimCardKeystoresProps extends KeystoreAvatarProps {
  keystores: ClaimCardKeystore[]
  alt: string
  status: ClaimStatus
}
export function ClaimCardKeystores({
  keystores,
  alt: _alt,
  status,
  ...props
}: ClaimCardKeystoresProps): JSX.Element | null {
  // explicit checking undefined because null is a valid value for wallet
  if (keystores.length === 1 && keystores[0]) {
    return (
      <KeystoreAvatar
        alt={`${keystores[0].wallet} wallet`}
        src={getSupportedHardwareWalletLogoPath(keystores[0].wallet)}
        {...props}
      >
        <KeystoreAvatar.Badge>{getNonMultisigKeystoreAvatarIcon(status)}</KeystoreAvatar.Badge>
      </KeystoreAvatar>
    )
  } else if (keystores.length > 1) {
    return (
      <KeystoreAvatar.Group {...props}>
        {keystores
          .sort((a, b) => {
            if (a.isVerified === true) {
              return -1
            }
            if (b.isVerified === true) {
              return 1
            }
            if (a.wallet) {
              return -1
            }
            if (b.wallet) {
              return 1
            }
            return 0
          })
          .slice(0, 3)
          .map((keystore) => (
            <KeystoreAvatar
              key={keystore.id}
              icon={!keystore.wallet ? keyIcon : undefined}
              src={keystore.wallet ? getSupportedHardwareWalletLogoPath(keystore.wallet) : undefined}
              // put the identified/verified ones first, just identified in the middle and unidentified/unverified at the end
              order={keystore.isVerified === true ? 1 : keystore.wallet ? 0 : -1}
              alt={`${keystore.wallet} wallet`}
            >
              <KeystoreAvatar.Badge>{getMultisigKeystoreAvatarIcon(keystore, status)}</KeystoreAvatar.Badge>
            </KeystoreAvatar>
          ))}
      </KeystoreAvatar.Group>
    )
  }

  // should not happen
  return null
}

const commonProps = { stroke: 'shades.0', boxSize: '16px' } as const
const alertIcon = <AlertTriangleFilledIcon fill="warning.600" color="shades.0" {...commonProps} />
const verifiedIcon = <CheckCircleFilledIcon color="success.600" color2="white" {...commonProps} />
function getMultisigKeystoreAvatarIcon(keystore: ClaimCardKeystore, status: ClaimStatus) {
  if (status === 'expired' && keystore.wallet) {
    return alertIcon
  }

  if (status === 'verified' && keystore.wallet) {
    return verifiedIcon
  }

  // at this point it means it's pending

  if (keystore.isVerified === true) {
    return <CheckCircleFilledIcon color="neutral.100" color2="neutral.900" {...commonProps} />
  }

  return null // show nothing
}

function getNonMultisigKeystoreAvatarIcon(status: ClaimStatus) {
  if (status === 'expired') {
    return alertIcon
  } else if (status === 'pending' || status === 'unverified') {
    return null
  }

  return verifiedIcon
}
