import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  Flex,
  Grid,
  HStack,
  IconButton,
  Stack,
  Text,
  useDisclosure,
} from '@chakra-ui/react'
import { EmptyView, ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import { springs } from '@hoseki/packages/ui/design-system/animations/motion'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { ClaimCardKeystores, getBadgeConfigForClaim } from '@hoseki/packages/ui/prove-verify-ui'
import { CheckCircleFilledIcon } from '@hoseki/packages/ui/prove-verify-ui/icons/check-circle-filled'
import { StatusBadge, type StatusBadgeProps } from '@hoseki/packages/ui/prove-verify-ui/status-badge'
import { motion } from 'framer-motion'
import { ChartNoAxesCombined, FileText, LayoutGridIcon, ListIcon, Plus } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { BitcoinAmount } from '../../components/bitcoin-amount'
import { DeleteClaimModal } from '../../components/claims/claim-details/delete-claim-modal'
import { FiatAmountText } from '../../components/fiat-amount-text'
import { FirstAccountReady } from '../../components/onboarding/getting-started'
import { SensitiveValue } from '../../components/sensitive-value'
import { useAutoRefreshExchanges } from '../../hooks/use-auto-refresh-exchanges'
import { useQueryErrorToast } from '../../hooks/use-query-error-toast'
import { computeAccountTotals } from '../../lib/account-totals'
import { useGetBalancesPerClaimIds } from '../../lib/balances'
import { type RouterOutput, trpc } from '../../trpc'
import { type ClaimDto } from '../../trpc/server-types'
import { ensureClaimStatusNotExpired, mapClaimToClaimCardProps } from '../../utils/claim-utils'
import { isExchangeConnected, needsExchangeReconnect } from '../../utils/exchange-connection-status'
import { queryErrorMessage } from '../../utils/query-error-message'

type ExchangeAccountDto = RouterOutput['portalProve']['exchange']['list'][number]

const MotionBox = motion.create(Box)

const VIEW_OPTIONS = [
  { value: 'list', label: 'List view', icon: <ListIcon size={18} /> },
  { value: 'cards', label: 'Card view', icon: <LayoutGridIcon size={18} /> },
] as const
type ManualAccountDto = RouterOutput['portalProve']['manual']['list'][number]
type EtfAccountDto = RouterOutput['portalProve']['etf']['list'][number]

export function ClaimsPage(): JSX.Element {
  const [view, updateView] = useState<'list' | 'cards'>(() => {
    try {
      return localStorage.getItem('bcc:accounts-view') === 'list' ? 'list' : 'cards'
    } catch {
      return 'cards'
    }
  })
  const setView = (next: 'list' | 'cards'): void => {
    updateView(next)
    try {
      localStorage.setItem('bcc:accounts-view', next)
    } catch {
      /* Keep the in-memory preference. */
    }
  }
  useAutoRefreshExchanges()
  const navigate = useNavigate()
  const location = useLocation()
  const claimsQuery = trpc.portalProve.registry.claims.list.useQuery({ excludePending: false })
  const claimCountLimitQuery = trpc.portalProve.registry.claims.getCountLimit.useQuery()
  const exchangeAccountsQuery = trpc.portalProve.exchange.list.useQuery()
  const manualAccountsQuery = trpc.portalProve.manual.list.useQuery()
  const etfAccountsQuery = trpc.portalProve.etf.list.useQuery()
  const btcPriceQuery = trpc.portalProve.retrieveBitcoinPrice.useQuery()

  const archivedClaimsQuery = trpc.portalProve.registry.claims.listArchived.useQuery()
  const trpcUtils = trpc.useUtils()
  const restoreMutation = trpc.portalProve.registry.claims.restore.useMutation({
    onSuccess: async () => {
      await Promise.all([
        trpcUtils.portalProve.registry.claims.list.invalidate(),
        trpcUtils.portalProve.registry.claims.listArchived.invalidate(),
        trpcUtils.portalProve.controlCenter.getData.invalidate(),
      ])
      toast.success('Account restored')
    },
    onError: () => {
      toast.error('Failed to restore account')
    },
  })

  const claims = claimsQuery.data ?? []
  const exchangeAccounts = exchangeAccountsQuery.data ?? []
  const connectedExchangeAccounts = exchangeAccounts.filter(isExchangeConnected)
  const manualAccounts = manualAccountsQuery.data ?? []
  const etfAccounts = etfAccountsQuery.data ?? []
  const claimIds = claims.map((c) => c.id)
  const balancesQuery = useGetBalancesPerClaimIds({ claimIds, enabled: claimIds.length > 0 })

  useEffect(() => {
    if (location.hash !== '#archived') return

    const section = document.getElementById('archived')
    const toggle = document.getElementById('archived-accounts-toggle')
    const target = toggle ?? section
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
  }, [archivedClaimsQuery.data?.length, claimsQuery.isLoading, location.hash])

  const accountQueries = [claimsQuery, exchangeAccountsQuery, manualAccountsQuery, etfAccountsQuery]
  const failedAccountQuery = accountQueries.find((query) => query.isError)

  const retryAccounts = (): void => {
    for (const query of [...accountQueries, archivedClaimsQuery]) void query.refetch()
  }
  useQueryErrorToast(
    failedAccountQuery
      ? queryErrorMessage(failedAccountQuery.error, "Your accounts couldn't be loaded. Please try again.")
      : null,
    retryAccounts,
  )

  useQueryErrorToast(
    !failedAccountQuery && archivedClaimsQuery.isError
      ? queryErrorMessage(archivedClaimsQuery.error, "Archived accounts couldn't be loaded. Please try again.")
      : null,
    () => {
      void archivedClaimsQuery.refetch()
    },
  )

  if (accountQueries.some((query) => query.isLoading)) {
    return <Spinner fullPage size="xl" />
  }

  if (failedAccountQuery) {
    return (
      <Stack py={8} gap={4} align="start">
        <PageHeading title="Accounts" description="Your wallets and exchange accounts." />
        <Button variant="outline" onClick={retryAccounts}>
          Try Again
        </Button>
      </Stack>
    )
  }

  const limit = claimCountLimitQuery?.data ?? null
  const hasClaims =
    claims.length > 0 || exchangeAccounts.length > 0 || manualAccounts.length > 0 || etfAccounts.length > 0
  const btcUsdPrice = btcPriceQuery.data?.value ? Number(btcPriceQuery.data.value) : null
  const {
    totalSats: totalBtcSats,
    totalUsd,
    hasUnknownBalance,
    verifiedCount,
    pendingCount,
  } = computeAccountTotals({
    claims,
    claimBalances: balancesQuery.data,
    exchangeAccounts,
    manualAccounts,
    etfAccounts,
    btcUsdPrice,
  })
  const totalBtc = totalBtcSats / 100_000_000

  return (
    <>
      <Stack py={8} gap={0}>
        <FirstAccountReady
          ready={
            claims.some((claim) => balancesQuery.data?.get(claim.id)?.current != null) ||
            [...exchangeAccounts, ...manualAccounts, ...etfAccounts].some((account) => account.balance !== null)
          }
        />
        {limit !== null && claims.length >= limit && (
          <ErrorBanner
            mb={6}
            variant="warning"
            message={
              <>
                You have reached the maximum number of accounts you can add. Contact{' '}
                <Text as="a" href="mailto:support@hoseki.app" fontWeight="semibold">
                  support@hoseki.app
                </Text>{' '}
                to increase your limit.
              </>
            }
          />
        )}

        {/* Header */}
        <Flex align="flex-start" justify="space-between" pb={6} gap={4} flexWrap="wrap">
          <Box>
            <PageHeading title="Accounts" description="Manage your wallets, exchanges, and Bitcoin holdings." />
          </Box>
          {hasClaims && (
            <Button variant="outline" onClick={() => navigate('/accounts/add')}>
              Add Account
            </Button>
          )}
        </Flex>

        {hasClaims && (
          <Flex align="center" justify="space-between" gap={4} flexWrap="wrap" mb={6}>
            <Stack gap={2} minW={0} flex={1}>
              <Flex align="baseline" gap={3} flexWrap="wrap" minW={0}>
                <Text
                  textStyle={{ base: 'amount/compact', md: 'amount/primary' }}
                  fontWeight="medium"
                  color="text.primary"
                  fontFamily="body"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                  overflowWrap="anywhere"
                >
                  <SensitiveValue>
                    {hasUnknownBalance ? '—' : <BitcoinAmount btc={totalBtc.toFixed(8)} />}
                  </SensitiveValue>
                </Text>
                <FiatAmountText
                  primary
                  color={hasUnknownBalance || btcUsdPrice === null ? 'text.secondary' : 'status.success.fg'}
                >
                  <SensitiveValue>
                    {hasUnknownBalance
                      ? 'Some balances are unavailable'
                      : btcUsdPrice === null
                        ? 'USD unavailable'
                        : totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  </SensitiveValue>
                </FiatAmountText>
              </Flex>
              <Flex align="center" gap={3} flexWrap="wrap" aria-label="Account verification status">
                {claims.length > 0 && (
                  <Flex align="center" gap={1.5}>
                    {verifiedCount > 0 && <VerifiedBadge />}
                    <Text textStyle="text/sm" color={verifiedCount > 0 ? 'status.success.fg' : 'text.tertiary'}>
                      {verifiedCount === 0
                        ? 'No verified wallets'
                        : `${verifiedCount} Verified ${verifiedCount === 1 ? 'wallet' : 'wallets'}`}
                    </Text>
                  </Flex>
                )}
                {connectedExchangeAccounts.length > 0 && (
                  <Text textStyle="text/sm" color="status.success.fg">
                    {connectedExchangeAccounts.length} connected{' '}
                    {connectedExchangeAccounts.length === 1 ? 'exchange' : 'exchanges'}
                  </Text>
                )}
                {pendingCount > 0 && (
                  <Text textStyle="text/sm" color="status.warning.fg">
                    {pendingCount} pending
                  </Text>
                )}
              </Flex>
            </Stack>
            <Flex
              flexShrink={0}
              role="group"
              aria-label="Account view"
              p="4px"
              gap="2px"
              borderRadius="full"
              bg="var(--segment-track)"
              boxShadow="inset 0 1px 2px rgb(0 0 0 / 0.06)"
            >
              {VIEW_OPTIONS.map((option) => (
                <Box key={option.value} position="relative">
                  {view === option.value && (
                    <MotionBox
                      layoutId="accounts-view-pill"
                      position="absolute"
                      inset={0}
                      borderRadius="full"
                      bg="var(--segment-pill)"
                      boxShadow="var(--segment-pill-shadow)"
                      transition={springs.pill}
                    />
                  )}
                  <IconButton
                    aria-label={option.label}
                    aria-pressed={view === option.value}
                    icon={option.icon}
                    variant="ghost"
                    size="sm"
                    position="relative"
                    color={view === option.value ? 'text.primary' : 'text.secondary'}
                    _hover={{ bg: 'transparent', color: 'text.primary' }}
                    _active={{ bg: 'transparent', transform: 'scale(0.94)' }}
                    onClick={() => setView(option.value)}
                  />
                </Box>
              ))}
            </Flex>
          </Flex>
        )}

        {/* Account cards */}
        {hasClaims ? (
          view === 'list' ? (
            <Stack spacing={0} borderTop="1px solid" borderColor="border.subtle">
              {claims.map((claim) => (
                <AccountRow
                  key={claim.id}
                  name={claim.displayName ?? claim.officialName ?? 'Wallet'}
                  to={
                    claim.keystores.length > 1 && claim.status === 'pending'
                      ? `/multisig/${claim.id}`
                      : `/accounts/${claim.id}`
                  }
                  detail={getBadgeConfigForClaim(ensureClaimStatusNotExpired(claim)).label}
                  sats={balancesQuery.data?.get(claim.id)?.current?.toString() ?? null}
                  btcPrice={btcUsdPrice}
                />
              ))}
              {exchangeAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  name={account.displayName}
                  to={`${(exchangeConfig[account.exchange] ?? defaultExchangeConfig).detailsPath}/${account.id}`}
                  detail={`${(exchangeConfig[account.exchange] ?? defaultExchangeConfig).label} · ${isExchangeConnected(account) ? 'Connected' : 'Reconnect needed'}`}
                  sats={needsExchangeReconnect(account) ? null : account.balance}
                  btcPrice={btcUsdPrice}
                />
              ))}
              {manualAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  name={account.displayName}
                  to={`/accounts/manual/${account.id}`}
                  detail="Manually tracked Bitcoin"
                  sats={account.balance}
                  btcPrice={btcUsdPrice}
                />
              ))}
              {etfAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  name={account.displayName}
                  to={`/accounts/etf/${account.id}`}
                  detail="Manually tracked ETF"
                  sats={account.balance}
                  btcPrice={btcUsdPrice}
                />
              ))}
              <AddAccountTile view="list" />
            </Stack>
          ) : (
            <Grid
              templateColumns={{ base: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }}
              gap={4}
            >
              {claims.map((claim) => (
                <AccountCard
                  key={claim.id}
                  claim={claim}
                  balance={balancesQuery.data?.get(claim.id) ?? null}
                  totalBtcSats={totalBtcSats}
                  isLoadingBalance={balancesQuery.isLoading}
                />
              ))}
              {exchangeAccounts.map((account) => (
                <ExchangeAccountCard
                  key={account.id}
                  account={account}
                  totalBtcSats={totalBtcSats}
                  btcUsdPrice={btcUsdPrice}
                />
              ))}
              {manualAccounts.map((account) => (
                <ManualAccountCard
                  key={account.id}
                  account={account}
                  totalBtcSats={totalBtcSats}
                  btcUsdPrice={btcUsdPrice}
                />
              ))}
              {etfAccounts.map((account) => (
                <ManualAccountCard
                  key={account.id}
                  account={{ ...account, balance: account.balance }}
                  totalBtcSats={totalBtcSats}
                  btcUsdPrice={btcUsdPrice}
                  linkPrefix="/accounts/etf"
                />
              ))}
              <AddAccountTile view="cards" />
            </Grid>
          )
        ) : (
          <EmptyHoldings onAdd={() => navigate('/accounts/add')} />
        )}

        {/* Archived accounts accordion */}
        <Box id="archived" mt={6} tabIndex={-1}>
          {archivedClaimsQuery.isLoading && (
            <Flex align="center" gap={2} color="text.secondary" role="status">
              <Spinner size="sm" />
              <Text textStyle="text/sm">Loading archived accounts…</Text>
            </Flex>
          )}
          {archivedClaimsQuery.isError && (
            <Stack gap={3} align="flex-start">
              <Button size="sm" variant="outline" onClick={() => archivedClaimsQuery.refetch()}>
                Retry
              </Button>
            </Stack>
          )}
          {archivedClaimsQuery.data && archivedClaimsQuery.data.length > 0 && (
            <Accordion allowToggle defaultIndex={location.hash === '#archived' ? 0 : undefined}>
              <AccordionItem border="1px solid" borderColor="border.subtle" borderRadius="md">
                <AccordionButton id="archived-accounts-toggle" px={4} py={3} _hover={{ bg: 'surface.subtle' }}>
                  <Text textStyle="text/sm" fontWeight="medium" color="text.secondary" flex={1} textAlign="left">
                    Archived ({archivedClaimsQuery.data.length})
                  </Text>
                  <AccordionIcon />
                </AccordionButton>
                <AccordionPanel px={4} pb={4}>
                  <Stack gap={2}>
                    {archivedClaimsQuery.data.map((archivedClaim) => (
                      <ArchivedClaimRow
                        key={archivedClaim.id}
                        claim={archivedClaim}
                        onRestore={() => restoreMutation.mutate({ id: archivedClaim.id })}
                        isRestoring={
                          restoreMutation.isLoading && restoreMutation.variables?.['id'] === archivedClaim.id
                        }
                        isRestoreDisabled={restoreMutation.isLoading}
                      />
                    ))}
                  </Stack>
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          )}
        </Box>
      </Stack>
    </>
  )
}

function AccountCardFrame({
  to,
  name,
  icon,
  badge,
  balanceSats,
  totalBtcSats,
  children,
}: {
  to: string
  name: string
  icon: ReactNode
  badge: Pick<StatusBadgeProps, 'status' | 'label'>
  balanceSats: number
  totalBtcSats: number
  children: ReactNode
}): JSX.Element {
  return (
    <Stack
      as={Link}
      to={to}
      layerStyle="edge"
      borderRadius="panel"
      p={4}
      gap={3}
      minW={0}
      minH="280px"
      textAlign="center"
      transition="border-color 150ms ease, background-color 150ms ease"
      _hover={{ bg: 'var(--edge-bg-hover)' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '3px' }}
    >
      <Flex minH={5} align="flex-start">
        <StatusBadge status={badge.status} label={badge.label} size="sm" />
      </Flex>
      <Flex
        align="center"
        justify="center"
        h={12}
        color={badge.status === 'warning' ? 'status.warning.fg' : 'text.secondary'}
      >
        {icon}
      </Flex>
      <Stack gap={2} flex={1} justify="center" minW={0}>
        <Text textStyle="text/md" fontWeight="medium" color="text.primary" overflowWrap="anywhere">
          {name}
        </Text>
        <Box minW={0} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {children}
        </Box>
      </Stack>
      <PortfolioShare balanceSats={balanceSats} totalBtcSats={totalBtcSats} />
    </Stack>
  )
}

function AccountCardBalance({
  btc,
  usd,
  loading = false,
}: {
  btc: number | null
  usd: number | null
  loading?: boolean
}): JSX.Element {
  if (loading)
    return (
      <Text textStyle="text/sm" color="text.secondary" role="status">
        Loading balance…
      </Text>
    )
  return (
    <Stack gap={1} align="center">
      <Text
        textStyle="text/xl"
        fontWeight="medium"
        color="text.primary"
        letterSpacing="-0.02em"
        overflowWrap="anywhere"
      >
        <SensitiveValue>{btc === null ? '—' : <BitcoinAmount btc={btc.toFixed(8)} />}</SensitiveValue>
      </Text>
      <FiatAmountText textAlign="center" color={btc === null || usd === null ? 'text.secondary' : 'status.success.fg'}>
        <SensitiveValue>
          {btc === null
            ? 'Balance unavailable'
            : usd === null
              ? 'USD unavailable'
              : usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </SensitiveValue>
      </FiatAmountText>
    </Stack>
  )
}

function PortfolioShare({ balanceSats, totalBtcSats }: { balanceSats: number; totalBtcSats: number }): JSX.Element {
  const percentage = totalBtcSats > 0 ? (balanceSats / totalBtcSats) * 100 : 0
  const fill = percentage > 0 ? Math.max(percentage, 1.5) : 0

  return (
    <Flex align="center" gap={2.5} pt={1}>
      <Box flex={1} h="3px" bg="surface.muted" borderRadius="full" overflow="hidden">
        <Box
          h="full"
          w={`${fill}%`}
          bg="surface.inverse"
          borderRadius="full"
          opacity={0.2}
          transition="width 150ms ease"
        />
      </Box>
      <Text textStyle="text/xs" color="text.tertiary" whiteSpace="nowrap" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {percentage.toFixed(1)}%
      </Text>
    </Flex>
  )
}

interface AccountCardProps {
  claim: ClaimDto
  balance: { current: unknown; usd: unknown } | null
  totalBtcSats: number
  isLoadingBalance: boolean
}

function AccountCard({ claim, balance, totalBtcSats, isLoadingBalance }: AccountCardProps): JSX.Element {
  const isPendingMultisig = claim.keystores.length > 1 && claim.status === 'pending'
  const status = ensureClaimStatusNotExpired(claim)
  const cardProps = mapClaimToClaimCardProps(claim)
  return (
    <AccountCardFrame
      to={isPendingMultisig ? `/multisig/${claim.id}` : `/accounts/${claim.id}`}
      name={claim.displayName ?? claim.officialName ?? 'Wallet'}
      icon={<ClaimCardKeystores keystores={cardProps.keystores} alt="" status={status} />}
      badge={getBadgeConfigForClaim(status)}
      balanceSats={balance ? Number(balance.current) : 0}
      totalBtcSats={totalBtcSats}
    >
      <AccountCardBalance
        btc={balance ? Number(balance.current) / 100_000_000 : null}
        usd={balance?.usd != null ? Number(balance.usd) : null}
        loading={isLoadingBalance}
      />
    </AccountCardFrame>
  )
}

function EmptyHoldings({ onAdd }: { onAdd: () => void }): JSX.Element {
  return (
    <EmptyView
      layerStyle="edge"
      borderRadius="panel"
      bgGradient="linear(to-b, surface.subtle, surface.raised)"
      title="Your Bitcoin, in one place"
      description="Connect a wallet or exchange to see your Bitcoin balance and start verifying your ownership."
      action={<Button onClick={onAdd}>Add Your First Account</Button>}
    />
  )
}

interface ExchangeAccountCardProps {
  account: ExchangeAccountDto
  totalBtcSats: number
  btcUsdPrice: number | null
}

interface ExchangeConfig {
  label: string
  logo: string
  logoAlt: string
  detailsPath: string
}

const defaultExchangeConfig: ExchangeConfig = {
  label: 'Coinbase',
  logo: '/images/exchanges/coinbase.svg',
  logoAlt: 'Coinbase',
  detailsPath: '/accounts/coinbase',
}

const exchangeConfig: Record<string, ExchangeConfig> = {
  coinbase: defaultExchangeConfig,
  kraken: {
    label: 'Kraken',
    logo: '/images/exchanges/kraken.svg',
    logoAlt: 'Kraken',
    detailsPath: '/accounts/kraken',
  },
  robinhood: {
    label: 'Robinhood',
    logo: '/images/exchanges/robinhood-icon.svg',
    logoAlt: 'Robinhood',
    detailsPath: '/accounts/robinhood',
  },
  strike: {
    label: 'Strike',
    logo: '/images/exchanges/strike-icon.svg',
    logoAlt: 'Strike',
    detailsPath: '/accounts/strike',
  },
}

function ExchangeAccountCard({ account, totalBtcSats, btcUsdPrice }: ExchangeAccountCardProps): JSX.Element {
  const needsReconnect = needsExchangeReconnect(account)
  const btc = account.balance === null || needsReconnect ? null : Number(account.balance) / 100_000_000
  const config = exchangeConfig[account.exchange] ?? defaultExchangeConfig
  return (
    <AccountCardFrame
      to={`${config.detailsPath}/${account.id}`}
      name={account.displayName}
      icon={<Box as="img" src={config.logo} alt="" maxW="64px" h={6} objectFit="contain" />}
      badge={{ status: needsReconnect ? 'error' : 'success', label: needsReconnect ? 'Reconnect needed' : 'Connected' }}
      balanceSats={btc === null ? 0 : Number(account.balance)}
      totalBtcSats={totalBtcSats}
    >
      <AccountCardBalance
        btc={btc}
        usd={btc !== null && btcUsdPrice !== null ? btc * btcUsdPrice : null}
        loading={!needsReconnect && account.balance === null}
      />
    </AccountCardFrame>
  )
}

interface ManualAccountCardProps {
  account: ManualAccountDto | EtfAccountDto
  totalBtcSats: number
  btcUsdPrice: number | null
  linkPrefix?: string
}

function ManualAccountCard({
  account,
  totalBtcSats,
  btcUsdPrice,
  linkPrefix = '/accounts/manual',
}: ManualAccountCardProps): JSX.Element {
  const btc = account.balance === null ? null : Number(account.balance) / 100_000_000
  const isEtf = linkPrefix === '/accounts/etf'
  return (
    <AccountCardFrame
      to={`${linkPrefix}/${account.id}`}
      name={account.displayName}
      icon={isEtf ? <ChartNoAxesCombined size={20} /> : <FileText size={20} />}
      badge={{ status: 'warning', label: 'Manually Added' }}
      balanceSats={account.balance === null ? 0 : Number(account.balance)}
      totalBtcSats={totalBtcSats}
    >
      <AccountCardBalance btc={btc} usd={btc !== null && btcUsdPrice !== null ? btc * btcUsdPrice : null} />
    </AccountCardFrame>
  )
}

function VerifiedBadge(): JSX.Element {
  return <CheckCircleFilledIcon boxSize="16px" color="status.success.fg" color2="text.inverse" aria-hidden="true" />
}

interface ArchivedClaimRowProps {
  claim: ClaimDto
  onRestore: () => void
  isRestoring: boolean
  isRestoreDisabled: boolean
}

function ArchivedClaimRow({ claim, onRestore, isRestoring, isRestoreDisabled }: ArchivedClaimRowProps): JSX.Element {
  const cardProps = mapClaimToClaimCardProps(claim)
  const { isOpen, onOpen, onClose } = useDisclosure()

  return (
    <>
      <Flex
        align={{ base: 'stretch', sm: 'center' }}
        direction={{ base: 'column', sm: 'row' }}
        justify="space-between"
        gap={2}
        px={3}
        py={2}
        borderRadius="md"
        border="1px solid"
        borderColor="border.subtle"
        bg="surface.subtle"
      >
        <Flex align="center" gap={3} minW={0}>
          <ClaimCardKeystores keystores={cardProps.keystores} alt={claim.displayName} status={cardProps.status} />
          <Text textStyle="text/sm" fontWeight="medium" color="text.primary" isTruncated>
            {claim.displayName ?? claim.officialName}
          </Text>
        </Flex>
        <HStack gap={2} justify="flex-end" flexShrink={0}>
          <Button color="status.error.fg" variant="ghost" size="sm" onClick={onOpen} isDisabled={isRestoreDisabled}>
            Delete Permanently
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRestore}
            isLoading={isRestoring}
            isDisabled={isRestoreDisabled}
          >
            Restore
          </Button>
        </HStack>
      </Flex>
      <DeleteClaimModal action="deletePermanently" isOpen={isOpen} onClose={onClose} claim={claim} />
    </>
  )
}

function AccountRow({
  name,
  to,
  detail,
  sats,
  btcPrice,
}: {
  name: string
  to: string
  detail: string
  sats: string | null
  btcPrice: number | null
}): JSX.Element {
  const btc = sats === null ? null : Number(sats) / 100_000_000
  return (
    <Flex
      as={Link}
      to={to}
      align="center"
      justify="space-between"
      gap={4}
      py={5}
      px={3}
      borderBottom="1px solid"
      borderColor="border.subtle"
      minW={0}
      flexWrap="wrap"
      transition="background-color 150ms ease"
      _hover={{ bg: 'surface.subtle' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '2px' }}
    >
      <Box flex="1" minW="140px">
        <Text textStyle="text/md" fontWeight="medium" overflowWrap="anywhere">
          {name}
        </Text>
        <Text textStyle="text/sm" color="text.secondary" mt={1}>
          {detail}
        </Text>
      </Box>
      <Box textAlign="right" minW={0} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        <Text textStyle="text/lg" fontWeight="medium">
          <SensitiveValue>{btc === null ? '—' : <BitcoinAmount btc={btc.toFixed(8)} />}</SensitiveValue>
        </Text>
        <FiatAmountText mt={1} color={btc === null || btcPrice === null ? 'text.secondary' : 'status.success.fg'}>
          <SensitiveValue>
            {btc === null || btcPrice === null
              ? 'USD unavailable'
              : (btc * btcPrice).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </SensitiveValue>
        </FiatAmountText>
      </Box>
    </Flex>
  )
}

function AddAccountTile({ view }: { view: 'list' | 'cards' }): JSX.Element {
  return (
    <Flex
      as={Link}
      to="/accounts/add"
      aria-label="Add account"
      align="center"
      justify={view === 'cards' ? 'center' : 'flex-start'}
      direction={view === 'cards' ? 'column' : 'row'}
      gap={3}
      p={5}
      mt={view === 'list' ? 4 : undefined}
      textAlign={view === 'cards' ? 'center' : 'left'}
      minH={view === 'cards' ? '164px' : '104px'}
      border="1px dashed"
      borderColor="border.strong"
      borderRadius="panel"
      transition="border-color 150ms ease, background-color 150ms ease"
      color="text.tertiary"
      _hover={{ bg: 'surface.subtle', borderColor: 'border.strong' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '2px' }}
    >
      <Plus size={24} aria-hidden="true" style={{ flexShrink: 0 }} />
      <Box minW={0}>
        <Text textStyle="text/md" fontWeight="medium" color="text.primary">
          Add account
        </Text>
        <Text textStyle="text/sm" color="text.secondary" mt={1} maxW={view === 'cards' ? '28ch' : undefined}>
          Connect a wallet or exchange, or track holdings manually.
        </Text>
      </Box>
    </Flex>
  )
}
