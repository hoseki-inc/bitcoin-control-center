import { Box, Button, Flex, IconButton, Stack, Text, chakra } from '@chakra-ui/react'
import { PageTransition, TextSkeleton } from '@hoseki/packages/ui/design-system'
import { Spinner } from '@hoseki/packages/ui/design-system/spinner'
import { SuccessCheck } from '@hoseki/packages/ui/prove-verify-ui'
import { formatUsd } from '@hoseki/packages/ui/utils/format'
import { useReducedMotion } from 'framer-motion'
import { XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks'
import { useCountUpProgress } from '../../hooks/use-count-up-progress'
import type { BalanceState } from '../../lib/balances'
import { formatBitcoinNumber } from '../../lib/bitcoin-display'
import { FiatAmountText } from '../fiat-amount-text'

/**
 * What floats above the title: a device's photo, or an app's icon on a white tile when there's no device. The
 * tile is decorative, since the title names the account.
 */
export type ConnectionHero = { photo: string; alt: string; height?: string } | { icon: ReactNode }

export interface ConnectionAction {
  label: string
  onClick: () => void
}

/** Shown while an account is saved or verified. Its hero and title sit where the success screen puts them. */
export function ConnectionPending({ title, hero }: { title: string; hero?: ConnectionHero }): JSX.Element {
  return (
    <PageTransition>
      <ScreenColumn>
        <Lockup
          title={title}
          hero={hero}
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
 * Celebrates a newly connected account: the hero with a green check on its corner, the title, then the balance
 * at full size, counting up from zero once it's known, and at most two actions.
 */
export function ConnectionSuccess({
  hero,
  title,
  subtitle,
  balance,
  badge,
  primary,
  secondary,
  onClose,
  closeTitle,
}: {
  hero?: ConnectionHero
  title: string
  subtitle: string
  balance?: BalanceState
  /** Shown beneath the balance, such as the account's Verified or Unverified badge. */
  badge?: ReactNode
  primary: ConnectionAction
  secondary?: ConnectionAction
  onClose: () => void
  closeTitle: string
}): JSX.Element {
  const reduceMotion = useReducedMotion() === true

  return (
    <PageTransition>
      {!reduceMotion && <Fireworks autorun={{ speed: 2, duration: 5_000, delay: 500 }} />}
      <ScreenColumn>
        <IconButton
          aria-label="Close"
          title={closeTitle}
          icon={<XIcon size={24} />}
          variant="ghost"
          position="absolute"
          top={4}
          left={4}
          onClick={onClose}
        />

        <Lockup
          title={title}
          subtitle={subtitle}
          hero={hero}
          badge={
            <Box bg="white" borderRadius="full" p="3px">
              <SuccessCheck size="52px" />
            </Box>
          }
        />

        {balance && <SuccessBalance balance={balance} badge={badge} />}

        <Stack w="full" maxW="20rem" gap={2} mt={{ base: 10, md: 12 }}>
          <Button onClick={primary.onClick}>{primary.label}</Button>
          {secondary && (
            <Button variant="ghost" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
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

/**
 * The hero with a status mark on its corner, then the title. Both screens share it, so nothing moves. The hero's
 * box is the same height for every account, so titles line up from one screen to the next.
 */
function Lockup({
  title,
  subtitle,
  hero,
  badge,
}: {
  title: string
  subtitle?: string
  hero?: ConnectionHero
  badge: ReactNode
}) {
  // The title takes focus when it changes, so screen readers announce the success once it lands.
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [title])

  return (
    <>
      <Flex h="160px" align="center" justify="center">
        {hero && (
          <Box
            position="relative"
            sx={{
              animation: 'float 4s ease-in-out infinite',
              '@keyframes float': {
                '0%': { transform: 'translateY(0)' },
                '50%': { transform: 'translateY(-6px)' },
                '100%': { transform: 'translateY(0)' },
              },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          >
            {'photo' in hero ? (
              <>
                <chakra.img
                  src={hero.photo}
                  alt={hero.alt}
                  h={hero.height ?? '140px'}
                  display="block"
                  filter="drop-shadow(-8px 10px 15px rgba(0, 0, 0, 0.5))"
                />
                <Box position="absolute" right="-10px" bottom="2px">
                  {badge}
                </Box>
              </>
            ) : (
              <>
                <Flex
                  aria-hidden
                  h="104px"
                  minW="104px"
                  px={5}
                  align="center"
                  justify="center"
                  bg="white"
                  borderWidth="1px"
                  borderColor="neutral.100"
                  borderRadius="24px"
                  boxShadow="0 10px 24px -6px rgba(0, 0, 0, 0.18)"
                >
                  {hero.icon}
                </Flex>
                <Box position="absolute" right="-18px" bottom="-14px">
                  {badge}
                </Box>
              </>
            )}
          </Box>
        )}
      </Flex>

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

/** The reward: the account's balance at full size, counting up from zero once it's known. */
function SuccessBalance({ balance, badge }: { balance: BalanceState; badge?: ReactNode }) {
  const value = balance.isLoading ? null : balance.data
  const progress = useCountUpProgress(value !== null)

  let btc: ReactNode = <TextSkeleton width="7ch" />
  let usd: ReactNode = <TextSkeleton width="9ch" />
  if (value !== null) {
    btc = formatBitcoinNumber(value.current.mul(progress).floor().div(100_000_000))
    usd = value.usd === null ? 'USD unavailable' : formatUsd(value.usd.mul(progress).toFixed(2))
  } else if (!balance.isLoading) {
    // The balance couldn't be read, so it can't be known yet.
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
      {badge !== undefined && (
        <Box as="span" mt={3}>
          {badge}
        </Box>
      )}
    </Stack>
  )
}
