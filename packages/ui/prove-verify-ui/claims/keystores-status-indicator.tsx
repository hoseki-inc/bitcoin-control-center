import {
  Box,
  type BoxProps,
  Flex,
  type FlexProps,
  HStack,
  Icon,
  Text,
  Tooltip,
  VStack,
  forwardRef,
} from '@chakra-ui/react'
import { type SupportedHardwareWallet, getSupportedHardwareWalletLogoPath } from '@hoseki/packages/wallet'
import { useState } from 'react'
import { rotateClockwise } from '../../design-system/animations/animations'
import { opacityReveal } from '../../design-system/animations/motion'
import { CheckCircleFilledIcon, DashedCircleFilledIcon, PlusCircleIcon, RoundKeyIcon } from '../icons'
import { StatusBadge, type Status as StatusBadgeStatus } from '../status-badge'
import { KeystoreAvatar } from './keystore-avatar'

export type PendingKeystore = {
  id: string
  wallet: null
  name: string
  status: 'pending'
}

export type IdentifiedKeystore = {
  id: string
  wallet: SupportedHardwareWallet
  name: string
  status: 'identified'
}

export type VerifiedKeystore = {
  id: string
  wallet: SupportedHardwareWallet
  name: string
  status: 'verified'
}

export type ExpandedRingColor = 'yellow' | 'green'

export type Keystore = PendingKeystore | IdentifiedKeystore | VerifiedKeystore

export const keyIcon = <Icon as={RoundKeyIcon} fill="text.tertiary" color2="surface.base" stroke="none" boxSize="90%" />

type TooltipVariant = 'none' | 'pending' | 'verified'

export function KeystoresStatusIndicator({
  keystores,
  expandedKeystoreId,
  expandedRingColor = 'yellow',
  threshold,
  tooltipVariant,
  getKeystoreClickHandler,
}: {
  keystores: Keystore[]
  expandedKeystoreId: string | null
  expandedRingColor?: ExpandedRingColor
  threshold: number
  tooltipVariant: TooltipVariant
  getKeystoreClickHandler: (
    keystore: Keystore,
    index: number,
    allKeystores: Keystore[],
  ) => null | ((keystore: Keystore) => void)
}): JSX.Element {
  const [revealDetails, setRevealDetails] = useState(false)
  const sortedKeystores = keystores.sort((a, b) => {
    if (a.status === 'verified') return -1
    if (b.status === 'verified') return 1
    if (a.wallet) return -1
    if (b.wallet) return 1
    if (a.id === expandedKeystoreId) return -1
    if (b.id === expandedKeystoreId) return 1
    return 0
  })

  return (
    <HStack gap={4}>
      {sortedKeystores.map((keystore, index) => {
        const amIExpanded = expandedKeystoreId === keystore.id
        const handler = getKeystoreClickHandler(keystore, index, sortedKeystores)
        const amIActionable = Boolean(handler) && !amIExpanded
        const { icon, tooltipCopy } = getKeystoreHints(keystore.status, index, threshold, amIExpanded, tooltipVariant)

        return (
          <Flex
            as="button"
            disabled={!amIActionable}
            cursor={amIActionable ? 'pointer' : 'default'}
            key={keystore.name + keystore.id} // If we change this to just the `keystore.id`, it won't trigger the animation when user updates the name.
            onClick={(event) => {
              setRevealDetails(event.detail > 0)
              handler?.(keystore)
            }}
            alignItems="center"
          >
            <Tooltip isDisabled={!tooltipCopy} label={tooltipCopy} hasArrow placement="top">
              <GradientAnimatedRing
                isEnabled={amIExpanded || amIActionable}
                color={amIActionable ? 'gray' : expandedRingColor}
              >
                <KeystoreAvatar
                  variant="filled"
                  alt={keystore.name}
                  icon={!keystore.wallet ? keyIcon : undefined}
                  src={keystore.wallet ? getSupportedHardwareWalletLogoPath(keystore.wallet) : undefined}
                >
                  <KeystoreAvatar.Badge>{icon}</KeystoreAvatar.Badge>
                </KeystoreAvatar>
              </GradientAnimatedRing>
            </Tooltip>
            {amIExpanded && (
              <Box minW={0} sx={revealDetails ? opacityReveal : undefined}>
                <VStack ml={4} gap={1} alignItems="flex-start" overflow="hidden" maxW="200px">
                  <Text textStyle="text/md" isTruncated maxW="full">
                    {keystore.name}
                  </Text>
                  <StatusBadge status={getStatusBadgeStatus(keystore.status)} label={keystore.status} size="sm" />
                </VStack>
              </Box>
            )}
          </Flex>
        )
      })}
    </HStack>
  )
}

function getStatusBadgeStatus(status: Keystore['status']): StatusBadgeStatus {
  switch (status) {
    case 'pending':
      return 'warning'
    case 'identified':
      return 'neutral'
    case 'verified':
      return 'success'
  }
}

function getKeystoreHints(
  status: Keystore['status'],
  index: number,
  threshold: number,
  amIExpanded: boolean,
  tooltipVariant: TooltipVariant,
): { tooltipCopy: string | null; icon: JSX.Element } {
  const commonProps = { stroke: 'text.inverse', boxSize: '16px' } as const

  switch (status) {
    case 'pending': {
      return index < threshold
        ? {
            tooltipCopy: amIExpanded
              ? null
              : tooltipVariant === 'pending'
                ? 'Start with one key before moving on; keys can be added in any order.'
                : null,
            icon: <PlusCircleIcon strokeWidth="2" fill="surface.muted" color="text.primary" {...commonProps} />,
          }
        : {
            tooltipCopy:
              tooltipVariant === 'pending' ? 'This key is not required to complete your 2-of-3 configuration.' : null,
            icon: <DashedCircleFilledIcon boxSize={commonProps.boxSize} />,
          }
    }

    case 'identified':
      return {
        tooltipCopy: null,
        icon: <CheckCircleFilledIcon color="surface.muted" color2="text.primary" {...commonProps} />,
      }
    case 'verified':
      return {
        tooltipCopy: null,
        icon: (
          <CheckCircleFilledIcon color="status.success.fg" color2="text.inverse" {...commonProps} aria-hidden="true" />
        ),
      }
  }
}

export const GradientAnimatedRing = forwardRef<
  {
    children: React.ReactNode
    isEnabled: boolean
    color: 'gray' | ExpandedRingColor
    ringProps?: BoxProps
  } & FlexProps,
  'div'
>((props, ref) => {
  const { children, isEnabled, color, ringProps, ...rest } = props

  return (
    <Flex ref={ref} position="relative" p={'2.75px'} {...rest}>
      <>
        {isEnabled && (
          <Box
            position="absolute"
            inset={0}
            borderRadius="full"
            background={`conic-gradient(
            from 0deg,
            ${
              color === 'yellow'
                ? `#FFF7A0 0%,
                 #FFE56C 30%,
                 #FFD54A 70%,`
                : color === 'green'
                  ? `#FFFFFF 0%,
                   #ECFDF5 30%,
                   #34D399 70%,`
                  : `#FFFFFF 0%,
                   #F9F9F9 30%,
                   #94A3B8 70%,`
            }
            rgba(255,255,255,0.95) 100%
          )`}
            animation={`${rotateClockwise} 4s linear infinite`}
            {...ringProps}
          />
        )}
        <Box outline="1px solid" outlineColor="border.subtle" borderRadius="full" zIndex={1}>
          {children}
        </Box>
      </>
    </Flex>
  )
})
