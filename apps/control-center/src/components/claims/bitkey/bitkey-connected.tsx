import { Box, Button, Flex, IconButton, Stack, Text } from '@chakra-ui/react'
import { PageTransition, TextSkeleton } from '@hoseki/packages/ui/design-system'
import { Spinner } from '@hoseki/packages/ui/design-system/spinner'
import { StatusBadge, SuccessCheck, getBadgeConfigForClaim } from '@hoseki/packages/ui/prove-verify-ui'
import { formatUsd } from '@hoseki/packages/ui/utils/format'
import { FloatingBitkeyImage } from '@hoseki/packages/ui/wallet-ui'
import { useReducedMotion } from 'framer-motion'
import { XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks'
import { useNavigate } from 'react-router'
import { useCountUpProgress } from '../../../hooks/use-count-up-progress'
import { useGetClaimBalance } from '../../../lib/balances'
import { formatBitcoinNumber } from '../../../lib/bitcoin-display'
import type { ClaimDto } from '../../../trpc/server-types'
import { FiatAmountText } from '../../fiat-amount-text'
import { UnverifiedTooltip } from './bitkey-notes'

/** Shown while Sentinel saves the Bitkey. Its device and title sit where the success screen puts them. */
export function BitkeyConnecting(): JSX.Element {
  return (
    <PageTransition>
      <ScreenColumn>
        <Lockup
          title="Connecting Your Bitkey..."
          badge={
            <Flex boxSize="58px" align="center" justify="center" bg="white" borderRadius="full">
              <Spinner size="md" />
            </Flex>
          }
        />
      </ScreenColumn>
    </PageTransition>
  )
}

/**
 * Celebrates a newly added Bitkey. It says "connected", never "verified": the balance leads, counting up once
 * Sentinel has scanned the wallet, and the Unverified badge stays beneath it.
 */
export function BitkeyConnected({ claim }: { claim: ClaimDto }): JSX.Element {
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion() === true
  const accountPath = `/accounts/${claim.id}`

  return (
    <PageTransition>
      {!reduceMotion && <Fireworks autorun={{ speed: 2, duration: 5_000, delay: 500 }} />}
      <ScreenColumn>
        <IconButton
          aria-label="Close"
          title="View Bitkey"
          icon={<XIcon size={24} />}
          variant="ghost"
          position="absolute"
          top={4}
          left={4}
          onClick={() => {
            void navigate(accountPath)
          }}
        />

        <Lockup
          title="Bitkey Connected!"
          subtitle="Its balance and history now show in Control Center."
          badge={
            <Box bg="white" borderRadius="full" p="3px">
              {/* Gray, not green: the Bitkey is connected but stays unverified. */}
              <SuccessCheck size="52px" tone="neutral" />
            </Box>
          }
        />

        <ConnectedBalance claim={claim} />

        <Stack w="full" maxW="20rem" gap={2} mt={{ base: 10, md: 12 }}>
          <Button
            onClick={() => {
              void navigate(accountPath)
            }}
          >
            View Bitkey
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void navigate('/accounts/add')
            }}
          >
            Connect Another Account
          </Button>
        </Stack>
      </ScreenColumn>
    </PageTransition>
  )
}

function ScreenColumn({ children }: { children: ReactNode }) {
  return (
    <Stack position="relative" align="center" textAlign="center" gap={0} pt={8} pb={16} px={{ base: 6, md: 10 }}>
      {children}
    </Stack>
  )
}

/** The device with a status mark on its corner, then the title. Both screens share it, so nothing moves. */
function Lockup({ title, subtitle, badge }: { title: string; subtitle?: string; badge: ReactNode }) {
  // The title takes focus when it changes, so screen readers announce "Connected" once it lands.
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [title])

  return (
    <>
      <FloatingBitkeyImage imageHeight="140px" pt={0} pb={0}>
        <Box position="absolute" right="-10px" bottom="2px">
          {badge}
        </Box>
      </FloatingBitkeyImage>

      <Text
        as="h1"
        ref={titleRef}
        tabIndex={-1}
        mt={6}
        textStyle={{ base: 'text/6xl', md: 'text/8xl' }}
        fontWeight="medium"
        color="neutral.900"
        sx={{ textWrap: 'balance' }}
        _focus={{ outline: 'none' }}
      >
        {title}
      </Text>
      {subtitle !== undefined && (
        <Text mt={2} maxW="36rem" textStyle="text/md" color="neutral.600" sx={{ textWrap: 'balance' }}>
          {subtitle}
        </Text>
      )}
    </>
  )
}

/** The reward: the Bitkey's balance at full size, counting up from zero when the scan finishes. */
function ConnectedBalance({ claim }: { claim: ClaimDto }) {
  const balanceQuery = useGetClaimBalance(claim.id)
  const balance = balanceQuery.isSuccess ? balanceQuery.data : null
  const progress = useCountUpProgress(balance !== null)
  const badge = getBadgeConfigForClaim(claim.status)

  let btc: ReactNode = <TextSkeleton width="7ch" />
  let usd: ReactNode = <TextSkeleton width="9ch" />
  if (balance !== null) {
    btc = formatBitcoinNumber(balance.current.mul(progress).floor().div(100_000_000))
    usd = balance.usd === null ? 'USD unavailable' : formatUsd(balance.usd.mul(progress).toFixed(2))
  } else if (!balanceQuery.isLoading) {
    // Sentinel couldn't scan the wallet, so the balance can't be known yet.
    btc = '—'
    usd = null
  }

  return (
    <Stack align="center" gap={1} mt={{ base: 10, md: 12 }}>
      <Flex align="baseline" columnGap={2}>
        <Text
          textStyle={{ base: 'amount/compact', md: 'amount/primary' }}
          fontWeight="medium"
          color="neutral.900"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {btc}
        </Text>
        <Text textStyle={{ base: 'text/lg', md: 'text/xl' }} fontWeight="medium" color="neutral.500">
          BTC
        </Text>
      </Flex>
      {usd !== null && (
        <FiatAmountText textStyle="text/lg" fontWeight="normal">
          {usd}
        </FiatAmountText>
      )}
      {/* Beside the badge, the tooltip doesn't cover View Bitkey. */}
      <UnverifiedTooltip>
        <Box as="span" mt={3}>
          <StatusBadge status={badge.status} label={badge.label} icon={badge.icon} size="sm" />
        </Box>
      </UnverifiedTooltip>
    </Stack>
  )
}
