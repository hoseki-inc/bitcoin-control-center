import {
  Box,
  type BoxProps,
  Checkbox,
  Flex,
  Grid,
  HStack,
  IconButton,
  RadioGroup,
  SimpleGrid,
  Stack,
  type SystemStyleObject,
  Text,
  chakra,
  useBreakpointValue,
  useToken,
} from '@chakra-ui/react'
import { HOSEKI_ASSETS_CDN_URL } from '@hoseki/packages/constants'
import { motion } from '@hoseki/packages/ui/design-system/animations/motion'
import { Header, Menu } from '@hoseki/packages/ui/prove-verify-ui/layout/header'
import { Logo } from '@hoseki/packages/ui/prove-verify-ui/logo'
import { StatusBadge } from '@hoseki/packages/ui/prove-verify-ui/status-badge'
import Decimal from 'decimal.js'
import { SettingsIcon } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ConnectionRowContent, LIVENESS_COLORS, connectionSummary } from '../../pages/settings/electrum-settings'
import { STATEMENT_SOURCES, StatementSourceOption } from '../../pages/settings/statement-source-settings'
import { BitcoinAmount } from '../bitcoin-amount'
import { ManualEntryIcon, ManualSignIcon, MultisigImage } from '../claims/account-type-media'
import { AccumulationChart } from '../dashboard-charts/accumulation-chart'
import { type BalanceDataPoint, getFlowTotals } from '../dashboard-charts/balance-history'
import { MonthlyNetChangeChart } from '../dashboard-charts/monthly-net-change-chart'
import { NetAccumulatedSummary } from '../dashboard-charts/net-accumulated-summary'
import { DashboardAmount } from '../dashboard/dashboard-typography'
import { PortfolioSummary } from '../dashboard/portfolio-summary'
import { FiatAmountText } from '../fiat-amount-text'
import { SAMPLE_BTC_PRICE, sampleBalanceHistory } from './sample-history'

// The app's own components with sample data, arranged as floating cards. Never the user's data.

// Every scene is laid out at one size and scaled the same way, so text reads at one size across
// steps. Phones get a narrower, taller scene, so cards stack rather than being cropped.
const WIDE_SCENE = { width: 600, height: 680 }
const COMPACT_SCENE = { width: 480, height: 720 }

/**
 * Scales a scene to fit whole inside the preview pane, so the app's components keep their real
 * proportions. Cards may run off the scene's right and bottom edges; the pane clips them.
 */
function Stage({ children }: { children: ReactNode }): JSX.Element {
  const scene = useBreakpointValue({ base: COMPACT_SCENE, md: WIDE_SCENE }, { ssr: false }) ?? WIDE_SCENE
  const paneRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, top: 0 })

  useLayoutEffect(() => {
    const pane = paneRef.current
    if (pane === null || typeof ResizeObserver === 'undefined') {
      return
    }
    const fitScene = (): void => {
      const { width: paneWidth, height: paneHeight } = pane.getBoundingClientRect()
      const scale = Math.min(paneWidth / scene.width, paneHeight / scene.height)
      setFit({ scale, top: (paneHeight - scene.height * scale) / 2 })
    }
    fitScene()
    const observer = new ResizeObserver(fitScene)
    observer.observe(pane)
    return () => {
      observer.disconnect()
    }
  }, [scene])

  return (
    <Box ref={paneRef} position="absolute" inset={0} overflow="hidden">
      <Box
        position="absolute"
        top={`${fit.top}px`}
        left="50%"
        w={`${scene.width}px`}
        h={`${scene.height}px`}
        transform={`translateX(-50%) scale(${fit.scale})`}
        transformOrigin="top center"
      >
        {children}
      </Box>
    </Box>
  )
}

/** A card placed in a scene. Cards in front float with the dialog shadow. */
function Card({ front = false, ...props }: BoxProps & { front?: boolean }): JSX.Element {
  return (
    <Box
      position="absolute"
      bg="shades.0"
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
      boxShadow={front ? 'floating' : undefined}
      {...props}
    />
  )
}

/** Content that can't be focused or used, such as the Settings controls pictured here. */
function Inert(props: BoxProps): JSX.Element {
  // React 19 supports inert; the workspace still uses React 18 types.
  return <Box {...{ inert: true }} {...props} />
}

/**
 * Lets a pictured chart show its tooltip on hover where there's a mouse. Touch screens keep a still
 * picture, since a tap would pin the tooltip open with no hover to dismiss it.
 */
const hoverable: SystemStyleObject = {
  '@media (hover: hover) and (pointer: fine)': { pointerEvents: 'auto' },
}

/** Home's 30-day chart, answering the pointer but never taking keyboard focus. */
function HoverableAccumulationChart(props: Parameters<typeof AccumulationChart>[0]): JSX.Element {
  return (
    <Box sx={hoverable}>
      {/* Wide enough for labels like 0.8795; measuring them would be thrown off by the scene's scale. */}
      <AccumulationChart {...props} focusable={false} yAxisWidth={56} />
    </Box>
  )
}

function btcAt(point: BalanceDataPoint | undefined): Decimal {
  return new Decimal(point?.totalBalance ?? 0).div(100_000_000)
}

function sampleUsd(btc: Decimal.Value): string {
  return new Decimal(btc)
    .mul(SAMPLE_BTC_PRICE)
    .toNumber()
    .toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function useSampleHistory(): BalanceDataPoint[] {
  return useMemo(() => sampleBalanceHistory(new Date()), [])
}

/** Tiles fade and settle in one after another; with reduced motion they are simply there. */
function popIn(index: number): SystemStyleObject {
  const delay = index * 40
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

// ─── Your Bitcoin, in one place ─────────────────────────────────────────────

/** The balance over a year, with the Portfolio page's monthly stacking card floating over it. */
export function BalancePreview(): JSX.Element {
  const history = useSampleHistory()
  const total = btcAt(history.at(-1))
  const { inBtc, outBtc } = getFlowTotals(history)
  // Net only: Portfolio's in/out split would crowd the card at this size.
  const net = inBtc.minus(outBtc)

  return (
    <Stage>
      <Card
        top={{ base: '16px', md: '24px' }}
        left={{ base: '50px', md: '24px' }}
        w={{ base: '380px', md: '440px' }}
        p={6}
      >
        <DashboardAmount>
          <BitcoinAmount btc={total} />
        </DashboardAmount>
        <FiatAmountText mt={1}>{sampleUsd(total)}</FiatAmountText>
        <Box mt={6}>
          <HoverableAccumulationChart data={history} hasActivity isUp startLabel="month" />
        </Box>
      </Card>
      <Card
        front
        top={{ base: '308px', md: '304px' }}
        left={{ base: '8px', md: '76px' }}
        w={{ base: '464px', md: '500px' }}
        p={{ base: 4, md: 6 }}
      >
        <NetAccumulatedSummary
          ready
          inBtc={net}
          outBtc={new Decimal(0)}
          monthsInRange={12}
          btcPrice={SAMPLE_BTC_PRICE}
          caption="Last 12 months"
          isUpdating={false}
          isFetching={false}
        />
        <Box sx={hoverable}>
          <MonthlyNetChangeChart data={history} focusable={false} />
        </Box>
      </Card>
    </Stage>
  )
}

// ─── Bring in what you already use ──────────────────────────────────────────

function Wordmark({ src }: { src: string }): JSX.Element {
  return <chakra.img src={src} alt="" h="20px" maxW="100px" objectFit="contain" />
}

/** The same choices, pictures and names as Add Account. */
const ACCOUNT_TYPES: Array<{ name: string; media: ReactNode }> = [
  { name: 'Trezor', media: <Wordmark src={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/trezor.svg`} /> },
  { name: 'COLDCARD', media: <Wordmark src={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/coldcard.svg`} /> },
  { name: 'Ledger', media: <Wordmark src={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/ledger.svg`} /> },
  { name: 'Keystone', media: <Wordmark src="/images/hardware-wallets/keystone-logo.svg" /> },
  { name: 'Bitkey', media: <Wordmark src="/images/hardware-wallets/bitkey-logo.svg" /> },
  { name: 'Multisig', media: MultisigImage },
  { name: 'Coinbase', media: <Wordmark src="/images/exchanges/coinbase-wordmark.svg" /> },
  { name: 'Kraken', media: <Wordmark src="/images/exchanges/kraken-wordmark.svg" /> },
  { name: 'Robinhood', media: <Wordmark src="/images/exchanges/robinhood-lockup.png" /> },
  { name: 'Strike', media: <Wordmark src="/images/exchanges/strike-logo.svg" /> },
  { name: 'Manually Sign', media: <ManualSignIcon /> },
  { name: 'Track Balance, ETF,\nor xpub', media: <ManualEntryIcon /> },
]

export function AccountTypesPreview(): JSX.Element {
  return (
    <Stage>
      <Inert>
        <Card
          top={{ base: '84px', md: '56px' }}
          left={{ base: '12px', md: '24px' }}
          w={{ base: '456px', md: '552px' }}
          p={{ base: 5, md: 6 }}
        >
          <Text as="h3" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
            Connect New Account
          </Text>
          <Grid templateColumns="repeat(3, minmax(0, 1fr))" gap={3} mt={6}>
            {ACCOUNT_TYPES.map(({ name, media }, index) => (
              <Stack
                key={name}
                align="center"
                gap={4}
                px={3}
                py={5}
                border="1px solid"
                borderColor="neutral.200"
                borderRadius="4px"
                sx={popIn(index)}
              >
                <Flex justify="center" align="center" h="30px">
                  {media}
                </Flex>
                <Text textStyle="label/md" fontWeight="medium" textAlign="center" whiteSpace="pre-line">
                  {name}
                </Text>
              </Stack>
            ))}
          </Grid>
        </Card>
      </Inert>
    </Stage>
  )
}

// ─── It can see, not spend ──────────────────────────────────────────────────

const KRAKEN_BTC = 0.330532
const KRAKEN_SHARE = '34.8'

/** What the Kraken connect form asks for: read access only. */
const KRAKEN_PERMISSIONS = [
  { label: 'Query Funds', granted: true },
  { label: 'Query Ledger Entries', granted: true },
  { label: 'Create & Modify Orders', granted: false },
  { label: 'Withdraw Funds', granted: false },
]

/** A connected exchange as the Accounts page shows it, with the read-only key it was added with. */
export function PermissionsPreview(): JSX.Element {
  return (
    <Stage>
      <Inert>
        {/* Matches ExchangeAccountCard on the Accounts page. */}
        <Card
          top={{ base: '132px', md: '120px' }}
          left="64px"
          w="248px"
          p={2}
          pb={5}
          borderRadius="md"
          textAlign="center"
        >
          <HStack>
            <StatusBadge status="success" label="Connected" size="sm" ml="auto" />
          </HStack>
          <Flex justify="center" align="center" h="30px" my={2}>
            <chakra.img src="/images/exchanges/kraken.svg" alt="" h="30px" />
          </Flex>
          <Text textStyle="label/md" fontWeight="medium" color="neutral.600">
            Kraken
          </Text>
          <Stack gap={0} mx={4} mt={1}>
            <Text textStyle="text/lg" fontWeight="bold" color="neutral.900" letterSpacing="-0.02em">
              {KRAKEN_BTC.toFixed(8)} BTC
            </Text>
            <Text textStyle="text/sm" fontWeight="medium" color="success.600">
              {sampleUsd(KRAKEN_BTC)}
            </Text>
          </Stack>
          <Flex align="center" gap={2.5} mx={4} mt={1}>
            <Box flex={1} h="3px" bg="neutral.50" borderRadius="2px" overflow="hidden">
              <Box h="100%" w={`${KRAKEN_SHARE}%`} bg="neutral.900" borderRadius="2px" opacity={0.2} />
            </Box>
            <Text textStyle="label/xs" color="neutral.300">
              {KRAKEN_SHARE}%
            </Text>
          </Flex>
        </Card>
        <Card front top={{ base: '292px', md: '276px' }} left={{ base: '116px', md: '216px' }} w="320px" p={6}>
          <HStack gap={3}>
            <chakra.img src="/images/exchanges/kraken.svg" alt="" boxSize={8} />
            <Box>
              <Text textStyle="label/md" fontWeight="semibold" color="neutral.900">
                API key permissions
              </Text>
              <Text textStyle="text/xs" color="neutral.600" mt={1}>
                Kraken
              </Text>
            </Box>
          </HStack>
          <Stack gap={3} mt={5}>
            {KRAKEN_PERMISSIONS.map(({ label, granted }) => (
              <Checkbox key={label} size="sm" colorScheme="orange" isChecked={granted} isReadOnly>
                <Text textStyle="text/sm" color={granted ? 'neutral.900' : 'neutral.500'}>
                  {label}
                </Text>
              </Checkbox>
            ))}
          </Stack>
          <Text textStyle="text/xs" color="neutral.600" mt={5}>
            Only your Bitcoin balance and transaction history are read.
          </Text>
        </Card>
      </Inert>
    </Stage>
  )
}

// ─── Your data stays with you ───────────────────────────────────────────────

/** A saved-connection row as Settings lists it. */
function ConnectionRow({ selected = false, children }: { selected?: boolean; children: ReactNode }): JSX.Element {
  const [selectedEdge] = useToken('colors', ['neutral.900'])
  return (
    <Flex
      direction="column"
      align="flex-start"
      py={3}
      px={3}
      borderBottomWidth="1px"
      bg={selected ? 'neutral.50' : undefined}
      boxShadow={selected ? `inset 2px 0 0 ${selectedEdge}` : undefined}
    >
      {children}
    </Flex>
  )
}

/** Settings' Electrum connection and statement lookups, as they look with your own node. */
export function ConnectionsPreview(): JSX.Element {
  return (
    <Stage>
      <Inert>
        <Card
          top={{ base: '72px', md: '64px' }}
          left={{ base: '12px', md: '24px' }}
          w={{ base: '456px', md: '460px' }}
          p={6}
        >
          <Text textStyle="label/md" fontWeight="semibold">
            Electrum Server
          </Text>
          <Text textStyle="text/sm" color="neutral.600" mt={1}>
            Configure your Bitcoin Electrum server connection. Use your own server for maximum privacy.
          </Text>
          <Box mt={5}>
            <HStack justify="space-between" px={3} pb={2} borderBottomWidth="1px">
              <Text textStyle="label/sm">Saved connections</Text>
              <Text textStyle="text/xs" color="neutral.600">
                2 of 5
              </Text>
            </HStack>
            <ConnectionRow selected>
              <ConnectionRowContent nickname="Home node" liveness="connected" torEnabled={false} />
            </ConnectionRow>
            <ConnectionRow>
              <ConnectionRowContent nickname="Blockstream" liveness={null} torEnabled={false} />
            </ConnectionRow>
          </Box>
          <Stack gap={0} mt={5}>
            <Text textStyle="label/md" fontWeight="semibold">
              Home node
            </Text>
            <Text textStyle="text/xs" color={`${LIVENESS_COLORS.connected}.700`}>
              {connectionSummary('connected', { host: '192.168.1.20', port: 50001, protocol: 'tcp' }, false)}
            </Text>
          </Stack>
        </Card>
        <Card
          front
          top={{ base: '396px', md: '376px' }}
          left={{ base: '40px', md: '120px' }}
          w={{ base: '420px', md: '456px' }}
          p={6}
        >
          <Text textStyle="text/md" fontWeight="semibold" color="neutral.900">
            Statement data
          </Text>
          <Text textStyle="text/sm" color="neutral.500" mt={3} mb={2}>
            Look up transactions on
          </Text>
          <RadioGroup value="mempool">
            <SimpleGrid columns={2} spacing={3}>
              {STATEMENT_SOURCES.map((item) => (
                <StatementSourceOption key={item.value} item={item} isSelected={item.value === 'mempool'} />
              ))}
            </SimpleGrid>
          </RadioGroup>
          <Text mt={2} textStyle="text/xs" color="neutral.600">
            Fastest. Your IP address and transaction details are shared with mempool.space.
          </Text>
        </Card>
      </Inert>
    </Stage>
  )
}

// ─── Start with one account ─────────────────────────────────────────────────

const NAV = [
  { to: '/home', title: 'Home' },
  { to: '/accounts', title: 'Accounts' },
  { to: '/portfolio', title: 'Portfolio' },
  { to: '/statements', title: 'Statements' },
]

/** Home once a few accounts are in: the app's own header and overview, running off the edge. */
export function HomePreview(): JSX.Element {
  const history = useSampleHistory()
  // Home's 30 days.
  const recent = history.slice(-30)

  return (
    <Stage>
      <Card
        front
        top={{ base: '24px', md: '64px' }}
        left={{ base: '12px', md: '48px' }}
        w={{ base: '456px', md: '760px' }}
        overflow="hidden"
      >
        <Inert>
          <Header
            logo={<Logo />}
            menu={
              <Menu
                items={NAV}
                renderLink={(to, children) => (
                  <chakra.a href={to} aria-current={to === '/home' ? 'page' : undefined}>
                    {children}
                  </chakra.a>
                )}
              />
            }
            userInfo={<IconButton aria-label="Settings" variant="ghost" icon={<SettingsIcon size={20} />} />}
          />
        </Inert>
        <Box px={6} py={8}>
          <PortfolioSummary
            data={{
              currentTotalBalance: recent.at(-1)?.totalBalance ?? '0',
              currentBtcPrice: String(SAMPLE_BTC_PRICE),
              historicalData: recent,
            }}
            accountCount={4}
            AccumulationChart={HoverableAccumulationChart}
            portfolioLinkProps={{ tabIndex: -1 }}
          />
        </Box>
      </Card>
    </Stage>
  )
}
