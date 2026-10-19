import { Box, Flex, Grid, HStack, Icon, Stack, type SystemStyleObject, Text, chakra, useToken } from '@chakra-ui/react'
import { HOSEKI_ASSETS_CDN_URL } from '@hoseki/packages/constants'
import { motion } from '@hoseki/packages/ui/design-system/animations/motion'
import {
  ArrowLeftRightIcon,
  CheckIcon,
  FileTextIcon,
  type LucideIcon,
  MonitorIcon,
  PencilLineIcon,
  ServerIcon,
  TrendingUpIcon,
  UsersRoundIcon,
  XIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { formatBitcoin } from '../../lib/bitcoin-display'

// Small, static stand-ins for the app's screens. They show sample numbers, never the user's.

const LOGOS = {
  trezor: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/trezor.svg`,
  coldcard: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/coldcard.svg`,
  ledger: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/ledger.svg`,
  keystone: '/images/hardware-wallets/keystone-logo.svg',
  coinbase: '/images/exchanges/coinbase-wordmark.svg',
  kraken: '/images/exchanges/kraken-wordmark.svg',
  robinhood: '/images/exchanges/robinhood-lockup.png',
  strike: '/images/exchanges/strike-logo.svg',
} as const

const ICONS = {
  coinbase: '/images/exchanges/coinbase.svg',
  kraken: '/images/exchanges/kraken.svg',
  robinhood: '/images/exchanges/robinhood-icon.svg',
  strike: '/images/exchanges/strike-icon.svg',
  keystone: '/images/hardware-wallets/keystone-logo-mini.svg',
} as const

/** A window into the app, set into the preview pane so it runs off the right and bottom edges. */
function PreviewWindow({
  title,
  sample = false,
  children,
}: {
  title: string
  sample?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <Flex
      direction="column"
      position="absolute"
      top={{ base: 6, md: 14 }}
      left={{ base: 6, md: 10 }}
      right={0}
      bottom={0}
      bg="shades.0"
      border="1px solid"
      borderColor="neutral.200"
      borderRightWidth={0}
      borderBottomWidth={0}
      borderTopLeftRadius="panel"
      overflow="hidden"
    >
      <Flex
        align="center"
        justify="space-between"
        gap={3}
        px={5}
        py={3}
        borderBottom="1px solid"
        borderColor="neutral.200"
      >
        <Text textStyle="label/md" fontWeight="medium" color="neutral.900">
          {title}
        </Text>
        {sample && (
          <Text textStyle="label/sm" color="neutral.600" bg="neutral.100" px={2} py={1} borderRadius="full">
            Sample
          </Text>
        )}
      </Flex>
      <Box flex={1} p={5}>
        {children}
      </Box>
    </Flex>
  )
}

// ─── Your Bitcoin, in one place ─────────────────────────────────────────────

/** Month-end balances in BTC: steady saving with a couple of dips. */
const SAMPLE_BALANCES = [0.63, 0.64, 0.662, 0.655, 0.7, 0.718, 0.74, 0.731, 0.8, 0.832, 0.861, 0.912, 0.950532]
const CHART_WIDTH = 320
const CHART_HEIGHT = 120

function chartPoints(values: readonly number[]): Array<[number, number]> {
  const min = Math.min(...values)
  const range = Math.max(...values) - min
  return values.map((value, index) => [
    (index / (values.length - 1)) * CHART_WIDTH,
    // Leave room above the peak and below the low point.
    CHART_HEIGHT - 8 - ((value - min) / range) * (CHART_HEIGHT - 24),
  ])
}

function SampleChart(): JSX.Element {
  const [lineColor] = useToken('colors', ['success.500'])
  const points = chartPoints(SAMPLE_BALANCES)
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${CHART_WIDTH} ${CHART_HEIGHT} L0 ${CHART_HEIGHT} Z`

  return (
    <chakra.svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      w="full"
      h={{ base: '72px', md: '200px' }}
      mt={6}
      overflow="visible"
    >
      <defs>
        <linearGradient id="onboarding-sample-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={0.15} />
          <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#onboarding-sample-area)" />
      <path d={line} fill="none" stroke={lineColor} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </chakra.svg>
  )
}

export function BalancePreview(): JSX.Element {
  const first = SAMPLE_BALANCES[0] ?? 0
  const last = SAMPLE_BALANCES[SAMPLE_BALANCES.length - 1] ?? 0

  return (
    <PreviewWindow title="Home" sample>
      <Text textStyle="overline/sm" color="neutral.600">
        Total holdings
      </Text>
      <Text textStyle="amount/compact" fontWeight="medium" color="neutral.900" mt={1}>
        {formatBitcoin(last)}
      </Text>
      <Text textStyle="text/sm" color="success.700" mt={1}>
        +{formatBitcoin(last - first)} in 12 months
      </Text>
      <SampleChart />
    </PreviewWindow>
  )
}

// ─── Bring in what you already use ──────────────────────────────────────────

type AccountType = { name: string } & ({ logo: string; icon?: never } | { icon: LucideIcon; logo?: never })

const ACCOUNT_TYPES: AccountType[] = [
  { name: 'Trezor', logo: LOGOS.trezor },
  { name: 'COLDCARD', logo: LOGOS.coldcard },
  { name: 'Ledger', logo: LOGOS.ledger },
  { name: 'Keystone', logo: LOGOS.keystone },
  { name: 'Multisig', icon: UsersRoundIcon },
  { name: 'Coinbase', logo: LOGOS.coinbase },
  { name: 'Kraken', logo: LOGOS.kraken },
  { name: 'Robinhood', logo: LOGOS.robinhood },
  { name: 'Strike', logo: LOGOS.strike },
  { name: 'Manual Entry', icon: PencilLineIcon },
]

const TILE_STAGGER_MS = 40

/** Tiles fade and settle in one after another; with reduced motion they are simply there. */
function popIn(index: number): SystemStyleObject {
  const delay = index * TILE_STAGGER_MS
  return {
    opacity: 1,
    transform: 'none',
    transition: `opacity ${motion.revealMs}ms ${motion.easeOut} ${delay}ms, transform ${motion.revealMs}ms ${motion.easeOut} ${delay}ms`,
    '@starting-style': { opacity: 0, transform: 'translateY(4px) scale(0.96)' },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      '@starting-style': { opacity: 1, transform: 'none' },
    },
  }
}

export function AccountTypesPreview(): JSX.Element {
  return (
    <PreviewWindow title="Connect New Account">
      <Grid templateColumns="repeat(3, minmax(0, 1fr))" gap={2}>
        {ACCOUNT_TYPES.map((type, index) => (
          <Stack
            key={type.name}
            align="center"
            gap={2}
            px={2}
            py={3}
            border="1px solid"
            borderColor="neutral.200"
            borderRadius="control"
            sx={popIn(index)}
          >
            <Flex h="18px" align="center" justify="center">
              {type.logo !== undefined ? (
                <chakra.img src={type.logo} alt="" h="18px" maxW="72px" objectFit="contain" />
              ) : (
                <Icon as={type.icon} boxSize="18px" color="neutral.600" />
              )}
            </Flex>
            <Text textStyle="label/sm" fontWeight="medium" color="neutral.900" noOfLines={1}>
              {type.name}
            </Text>
          </Stack>
        ))}
      </Grid>
    </PreviewWindow>
  )
}

// ─── It can see, not spend ──────────────────────────────────────────────────

function SampleAccount({
  logo,
  name,
  access,
  balance,
}: {
  logo: string
  name: string
  access: string
  balance: number
}): JSX.Element {
  return (
    <Flex align="center" gap={3} p={3} border="1px solid" borderColor="neutral.200" borderRadius="control">
      <chakra.img src={logo} alt="" boxSize={8} p={1.5} bg="neutral.50" borderRadius="control" objectFit="contain" />
      <Box flex={1} minW={0}>
        <Text textStyle="label/md" fontWeight="medium" color="neutral.900">
          {name}
        </Text>
        <Text textStyle="text/xs" color="neutral.600">
          {access}
        </Text>
      </Box>
      <Text textStyle="label/md" color="neutral.900" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatBitcoin(balance)}
      </Text>
    </Flex>
  )
}

const ACCESS = [
  { label: 'View balances and history', allowed: true },
  { label: 'Trade', allowed: false },
  { label: 'Send or withdraw', allowed: false },
]

export function WatchOnlyPreview(): JSX.Element {
  return (
    <PreviewWindow title="Accounts" sample>
      <Stack gap={2}>
        <SampleAccount logo={ICONS.keystone} name="Keystone" access="Watch-only" balance={0.62} />
        <SampleAccount logo={ICONS.kraken} name="Kraken" access="Read-only key" balance={0.330532} />
      </Stack>
      <Text textStyle="overline/sm" color="neutral.600" mt={6} mb={2}>
        Control Center can
      </Text>
      <Stack gap={0}>
        {ACCESS.map(({ label, allowed }) => (
          <HStack key={label} gap={3} py={2} borderBottom="1px solid" borderColor="neutral.100">
            <Icon
              as={allowed ? CheckIcon : XIcon}
              boxSize={4}
              color={allowed ? 'success.600' : 'neutral.400'}
              strokeWidth={2.5}
            />
            <Text
              textStyle="text/sm"
              color={allowed ? 'neutral.900' : 'neutral.500'}
              textDecoration={allowed ? undefined : 'line-through'}
            >
              {label}
            </Text>
          </HStack>
        ))}
      </Stack>
    </PreviewWindow>
  )
}

// ─── Your data stays with you ───────────────────────────────────────────────

interface Source {
  icon: LucideIcon
  name: string
  detail?: string
  purpose: string
}

const DESKTOP_SOURCES: Source[] = [
  { icon: ServerIcon, name: 'Electrum server', detail: 'Public, or your own node', purpose: 'Balances' },
  { icon: ArrowLeftRightIcon, name: 'Exchanges you connect', purpose: 'Balances' },
  { icon: TrendingUpIcon, name: 'Price source', purpose: 'Bitcoin price' },
  { icon: FileTextIcon, name: 'mempool.space', purpose: 'Statements' },
]

const SERVER_SOURCES: Source[] = [
  { icon: ServerIcon, name: "Your node's Electrum server", purpose: 'Balances' },
  { icon: ArrowLeftRightIcon, name: 'Exchanges you connect', purpose: 'Balances' },
  { icon: TrendingUpIcon, name: 'Price source', purpose: 'Bitcoin price' },
]

export function DataSourcesPreview({ desktop }: { desktop: boolean }): JSX.Element {
  const sources = desktop ? DESKTOP_SOURCES : SERVER_SOURCES

  return (
    <PreviewWindow title="Your data">
      <Flex align="center" gap={3} p={3} border="1px solid" borderColor="neutral.200" borderRadius="control">
        <Flex boxSize={8} align="center" justify="center" bg="secondary.400" borderRadius="control" flexShrink={0}>
          <Icon as={desktop ? MonitorIcon : ServerIcon} boxSize={4} color="neutral.900" />
        </Flex>
        <Box minW={0}>
          <Text textStyle="label/md" fontWeight="medium" color="neutral.900">
            {desktop ? 'This computer' : 'Your server'}
          </Text>
          <Text textStyle="text/xs" color="neutral.600">
            Accounts, history and statements
          </Text>
        </Box>
      </Flex>
      <Text textStyle="overline/sm" color="neutral.600" mt={6} mb={1}>
        Reads from
      </Text>
      <Stack gap={0}>
        {sources.map(({ icon, name, detail, purpose }) => (
          <Flex key={name} align="center" gap={3} py={2} borderBottom="1px solid" borderColor="neutral.100">
            <Icon as={icon} boxSize={4} color="neutral.600" flexShrink={0} />
            <Box flex={1} minW={0}>
              <Text textStyle="text/sm" color="neutral.900">
                {name}
              </Text>
              {detail !== undefined && (
                <Text textStyle="text/xs" color="neutral.600">
                  {detail}
                </Text>
              )}
            </Box>
            <Text textStyle="text/xs" color="neutral.600" flexShrink={0}>
              {purpose}
            </Text>
          </Flex>
        ))}
      </Stack>
      {desktop && (
        <Text textStyle="text/xs" color="neutral.600" mt={3}>
          You can change these in Settings.
        </Text>
      )}
    </PreviewWindow>
  )
}

// ─── Start with one account ─────────────────────────────────────────────────

const GROUPS: Array<{ title: string; need: string; logos: string[]; icon?: LucideIcon }> = [
  { title: 'Wallets', need: 'Your hardware wallet', logos: [LOGOS.trezor, LOGOS.coldcard, LOGOS.ledger] },
  {
    title: 'Exchanges',
    need: 'A read-only API key',
    logos: [ICONS.coinbase, ICONS.kraken, ICONS.robinhood, ICONS.strike],
  },
  { title: 'Manual', need: 'Just your balance', logos: [], icon: PencilLineIcon },
]

export function GetReadyPreview(): JSX.Element {
  return (
    <PreviewWindow title="Connect New Account">
      <Stack gap={2}>
        {GROUPS.map(({ title, need, logos, icon }, index) => (
          <Flex
            key={title}
            align="center"
            justify="space-between"
            gap={3}
            p={4}
            border="1px solid"
            borderColor="neutral.200"
            borderRadius="control"
            sx={popIn(index)}
          >
            <Box minW={0}>
              <Text textStyle="label/md" fontWeight="medium" color="neutral.900">
                {title}
              </Text>
              <Text textStyle="text/xs" color="neutral.600" mt={1}>
                {need}
              </Text>
            </Box>
            <HStack gap={2} flexShrink={0}>
              {logos.map((logo) => (
                <chakra.img key={logo} src={logo} alt="" h="16px" maxW="56px" objectFit="contain" />
              ))}
              {icon !== undefined && <Icon as={icon} boxSize={4} color="neutral.600" />}
            </HStack>
          </Flex>
        ))}
      </Stack>
    </PreviewWindow>
  )
}
