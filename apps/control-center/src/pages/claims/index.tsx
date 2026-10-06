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
  Heading,
  Icon,
  Stack,
  Text,
  useDisclosure,
} from '@chakra-ui/react'
import { getRecordValue } from '@hoseki/packages/lib'
import { Spinner } from '@hoseki/packages/ui/design-system'
import { ClaimCardKeystores, getBadgeConfigForClaim } from '@hoseki/packages/ui/prove-verify-ui'
import { StatusBadge } from '@hoseki/packages/ui/prove-verify-ui/status-badge'
import { type ReactNode, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { BitcoinAmount } from '../../components/bitcoin-amount'
import { DeleteClaimModal } from '../../components/claims/claim-details/delete-claim-modal'
import { useAutoRefreshExchanges } from '../../hooks/use-auto-refresh-exchanges'
import { useQueryErrorToast } from '../../hooks/use-query-error-toast'
import { useGetBalancesPerClaimIds } from '../../lib/balances'
import { type RouterOutput, trpc } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import { ensureClaimStatusNotExpired, mapClaimToClaimCardProps } from '../../utils/claim-utils'
import { isExchangeConnected, needsExchangeReconnect } from '../../utils/exchange-connection-status'
import { queryErrorMessage } from '../../utils/query-error-message'

type ExchangeAccountDto = RouterOutput['portalProve']['exchange']['list'][number]
type ManualAccountDto = RouterOutput['portalProve']['manual']['list'][number]
type EtfAccountDto = RouterOutput['portalProve']['etf']['list'][number]

export function ClaimsPage(): JSX.Element {
  useAutoRefreshExchanges()
  const navigate = useNavigate()
  const location = useLocation()
  const claimsQuery = trpc.portalProve.registry.claims.list.useQuery({ excludePending: false })
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
    if (location.hash !== '#archived') {
      return
    }

    const section = document.getElementById('archived')
    const toggle = document.getElementById('archived-accounts-toggle')
    const target = toggle ?? section
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
  }, [archivedClaimsQuery.data?.length, claimsQuery.isLoading, location.hash])

  const accountQueries = [claimsQuery, exchangeAccountsQuery, manualAccountsQuery, etfAccountsQuery]
  const failedAccountQuery = accountQueries.find((query) => query.isError)

  const retryAccounts = (): void => {
    for (const query of [...accountQueries, archivedClaimsQuery]) {
      void query.refetch()
    }
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
        <HoldingsHeading />
        <Button variant="outline" onClick={retryAccounts}>
          Try Again
        </Button>
      </Stack>
    )
  }

  const hasClaims =
    claims.length > 0 || exchangeAccounts.length > 0 || manualAccounts.length > 0 || etfAccounts.length > 0
  const verifiedCount = claims.filter((c) => ensureClaimStatusNotExpired(c) === 'verified').length
  const pendingCount = claims.length - verifiedCount

  const claimTotalBtcSats = Array.from(balancesQuery.data.values()).reduce((sum, b) => {
    if (!b) {
      return sum
    }
    return sum + Number(b.current)
  }, 0)

  // Saved balances from exchanges that need reconnecting are stale, so they stay out of the totals.
  const exchangeTotalBtcSats = connectedExchangeAccounts.reduce((sum, a) => {
    if (a.balance == null || a.balance === '') {
      return sum
    }
    return sum + Number(a.balance)
  }, 0)

  const manualTotalBtcSats = manualAccounts.reduce((sum, a) => {
    if (!a.balance) {
      return sum
    }
    return sum + Number(a.balance)
  }, 0)

  const etfTotalBtcSats = etfAccounts.reduce((sum, a) => {
    if (!a.balance) {
      return sum
    }
    return sum + Number(a.balance)
  }, 0)

  const totalBtcSats = claimTotalBtcSats + exchangeTotalBtcSats + manualTotalBtcSats + etfTotalBtcSats
  const totalBtc = totalBtcSats / 100_000_000
  const hasUnknownBalance =
    claims.some((claim) => !balancesQuery.data.get(claim.id)) ||
    exchangeAccounts.some(needsExchangeReconnect) ||
    [...exchangeAccounts, ...manualAccounts, ...etfAccounts].some((account) => account.balance === null)

  const btcUsdPrice = btcPriceQuery.data?.value ? Number(btcPriceQuery.data.value) : null

  const claimsTotalUsd = Array.from(balancesQuery.data.values()).reduce((sum, b) => {
    if (!b?.usd) {
      return sum
    }
    return sum + Number(b.usd)
  }, 0)

  const exchangeTotalUsd =
    btcUsdPrice !== null
      ? connectedExchangeAccounts.reduce((sum, a) => {
          if (a.balance == null || a.balance === '') {
            return sum
          }
          return sum + (Number(a.balance) / 100_000_000) * btcUsdPrice
        }, 0)
      : 0

  const manualTotalUsd =
    btcUsdPrice !== null
      ? manualAccounts.reduce((sum, a) => {
          if (!a.balance) {
            return sum
          }
          return sum + (Number(a.balance) / 100_000_000) * btcUsdPrice
        }, 0)
      : 0

  const etfTotalUsd =
    btcUsdPrice !== null
      ? etfAccounts.reduce((sum, a) => {
          if (!a.balance) {
            return sum
          }
          return sum + (Number(a.balance) / 100_000_000) * btcUsdPrice
        }, 0)
      : 0

  const totalUsd = claimsTotalUsd + exchangeTotalUsd + manualTotalUsd + etfTotalUsd

  return (
    <>
      <Stack py={8} gap={0}>
        {/* Header */}
        <Flex align="flex-start" justify="space-between" pb={9} gap={4} flexWrap="wrap">
          <Box minW={0}>
            <HoldingsHeading />
            {hasClaims && (
              <Flex align="center" gap={3} mt={2} flexWrap="wrap" aria-label="Holdings summary">
                <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900" whiteSpace="nowrap">
                  <>{hasUnknownBalance ? '—' : <BitcoinAmount btc={totalBtc} />}</>
                </Text>
                <SummaryDot />
                <Text
                  textStyle="text/sm"
                  color={hasUnknownBalance || btcUsdPrice === null ? 'neutral.600' : 'success.600'}
                >
                  <>
                    {hasUnknownBalance
                      ? 'Some balances are unavailable'
                      : btcUsdPrice === null
                        ? 'USD unavailable'
                        : formatUsd(totalUsd)}
                  </>
                </Text>
                {verifiedCount > 0 && (
                  <>
                    <SummaryDot />
                    <Flex align="center" gap={1}>
                      <VerifiedBadge />
                      <Text textStyle="text/sm" color="success.600">
                        {verifiedCount} Verified
                      </Text>
                    </Flex>
                  </>
                )}
                {connectedExchangeAccounts.length > 0 && (
                  <>
                    <SummaryDot />
                    <Text textStyle="text/sm" color="success.600">
                      {connectedExchangeAccounts.length} Connected
                    </Text>
                  </>
                )}
                {pendingCount > 0 && (
                  <>
                    <SummaryDot />
                    <Text textStyle="text/sm" color="warning.600">
                      {pendingCount} Pending
                    </Text>
                  </>
                )}
              </Flex>
            )}
          </Box>
          <Button
            bg="neutral.900"
            color="shades.0"
            fontWeight="semibold"
            borderRadius="8px"
            onClick={() => {
              void navigate('/accounts/add')
            }}
            _hover={{ bg: 'neutral.700' }}
          >
            + Add Account
          </Button>
        </Flex>

        {/* Account cards */}
        {hasClaims ? (
          <Grid
            templateColumns={{ base: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }}
            autoRows="1fr"
            gap={4}
          >
            {claims.map((claim) => (
              <AccountCard
                key={claim.id}
                claim={claim}
                balance={balancesQuery.data.get(claim.id) ?? null}
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
                account={account}
                totalBtcSats={totalBtcSats}
                btcUsdPrice={btcUsdPrice}
                linkPrefix="/accounts/etf"
              />
            ))}
            <AddAccountCard
              onClick={() => {
                void navigate('/accounts/add')
              }}
            />
          </Grid>
        ) : (
          <EmptyHoldings
            onAdd={() => {
              void navigate('/accounts/add')
            }}
          />
        )}

        {/* Archived accounts accordion */}
        <Box id="archived" mt={6} tabIndex={-1}>
          {archivedClaimsQuery.isLoading && (
            <Flex align="center" gap={2} color="neutral.600">
              <Spinner size="sm" />
              <Text as="output" textStyle="text/sm">
                Loading archived accounts…
              </Text>
            </Flex>
          )}
          {archivedClaimsQuery.isError && (
            <Stack gap={3} align="flex-start">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void archivedClaimsQuery.refetch()
                }}
              >
                Retry
              </Button>
            </Stack>
          )}
          {archivedClaimsQuery.data && archivedClaimsQuery.data.length > 0 && (
            <Accordion allowToggle defaultIndex={location.hash === '#archived' ? 0 : undefined}>
              <AccordionItem border="1px solid" borderColor="neutral.200" borderRadius="md">
                <AccordionButton id="archived-accounts-toggle" px={4} py={3} _hover={{ bg: 'neutral.50' }}>
                  <Text textStyle="text/sm" fontWeight="medium" color="neutral.600" flex={1} textAlign="left">
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
                        onRestore={() => {
                          restoreMutation.mutate({ id: archivedClaim.id })
                        }}
                        isRestoring={restoreMutation.isLoading && restoreMutation.variables?.id === archivedClaim.id}
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

function HoldingsHeading(): JSX.Element {
  return (
    <Heading as="h1" textStyle="text/3xl" fontWeight="bold" color="neutral.900">
      My Holdings
    </Heading>
  )
}

function SummaryDot(): JSX.Element {
  return (
    <Text as="span" color="neutral.200" aria-hidden="true">
      ·
    </Text>
  )
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

interface AccountCardFrameProps {
  to: string
  name: string
  muted?: boolean
  badges: ReactNode
  icon: ReactNode
  balanceSats: number
  totalBtcSats: number
  children: ReactNode
}

/** The dense card from the original Holdings page: badge, logo, name, balance, and portfolio share. */
function AccountCardFrame({
  to,
  name,
  muted = false,
  badges,
  icon,
  balanceSats,
  totalBtcSats,
  children,
}: AccountCardFrameProps): JSX.Element {
  return (
    <Stack
      as={Link}
      to={to}
      bg={muted ? 'neutral.50' : 'shades.0'}
      borderRadius="md"
      border="1px solid"
      borderColor="neutral.200"
      p={2}
      pb={5}
      minW={0}
      cursor="pointer"
      transition="all 0.2s ease"
      gap={1}
      textAlign="center"
      _hover={{
        transform: 'translateY(-2px)',
        shadow: 'md',
      }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '3px' }}
    >
      <HStack>{badges}</HStack>
      {icon}
      <Stack gap={0} mx={4} minW={0}>
        <Text textStyle="label/md" fontWeight="medium" color={muted ? 'neutral.400' : 'neutral.600'} isTruncated>
          {name}
        </Text>
      </Stack>
      <Stack gap={0} mx={4} mt={1} minW={0}>
        {children}
      </Stack>
      <PortfolioShare balanceSats={balanceSats} totalBtcSats={totalBtcSats} />
    </Stack>
  )
}

function CardBalance({
  btc,
  usd,
  muted = false,
}: {
  btc: number | null
  usd: number | null
  muted?: boolean
}): JSX.Element {
  return (
    <>
      <Text
        fontFamily="mono"
        textStyle="text/lg"
        fontWeight="bold"
        color={btc === null || muted ? 'neutral.400' : 'neutral.900'}
        letterSpacing="-0.02em"
        overflowWrap="anywhere"
      >
        <>{btc === null ? '—' : <BitcoinAmount btc={btc} />}</>
      </Text>
      {btc !== null && usd !== null && (
        <Text textStyle="text/sm" fontWeight="medium" color="success.600">
          {formatUsd(usd)}
        </Text>
      )}
    </>
  )
}

function CardBalancePlaceholder(): JSX.Element {
  return <Box h="24px" w="120px" bg="neutral.50" borderRadius="4px" mx="auto" aria-label="Loading balance" />
}

function PortfolioShare({ balanceSats, totalBtcSats }: { balanceSats: number; totalBtcSats: number }): JSX.Element {
  const pct = totalBtcSats > 0 ? ((balanceSats / totalBtcSats) * 100).toFixed(1) : '0.0'

  return (
    <Flex align="center" gap={2.5} mx={4} mt={1}>
      <Box flex={1} h="3px" bg="neutral.50" borderRadius="2px" overflow="hidden">
        <Box
          h="100%"
          w={`${Math.max(parseFloat(pct), 1.5)}%`}
          bg="neutral.900"
          borderRadius="2px"
          opacity={0.2}
          transition="width 0.4s ease"
        />
      </Box>
      <Text textStyle="label/xs" color="neutral.300" fontFamily="mono" whiteSpace="nowrap">
        {pct}%
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
  const { status: badgeStatus, label: badgeLabel } = getBadgeConfigForClaim(status)
  const btcSats = balance ? Number(balance.current) : 0

  return (
    <AccountCardFrame
      to={isPendingMultisig ? `/multisig/${claim.id}` : `/accounts/${claim.id}`}
      name={claim.displayName}
      badges={
        <>
          {claim.keystores.length > 1 && (
            <StatusBadge
              status="neutral"
              label={`${cardProps.threshold} of ${claim.keystores.length}`}
              size="sm"
              textTransform="none"
            />
          )}
          <StatusBadge status={badgeStatus} label={badgeLabel} size="sm" ml="auto" />
        </>
      }
      icon={<ClaimCardKeystores keystores={cardProps.keystores} alt="" status={status} mx="auto" />}
      balanceSats={btcSats}
      totalBtcSats={totalBtcSats}
    >
      {isLoadingBalance ? (
        <CardBalancePlaceholder />
      ) : (
        <CardBalance
          btc={balance ? btcSats / 100_000_000 : null}
          usd={balance?.usd != null ? Number(balance.usd) : null}
        />
      )}
    </AccountCardFrame>
  )
}

interface AddAccountCardProps {
  onClick: () => void
}

function AddAccountCard({ onClick }: AddAccountCardProps): JSX.Element {
  return (
    <Flex
      as="button"
      type="button"
      aria-label="Add account"
      _focusVisible={{ boxShadow: 'outline' }}
      onClick={onClick}
      borderRadius="10px"
      border="1.5px dashed"
      borderColor="neutral.200"
      px={5}
      py={7}
      cursor="pointer"
      direction="column"
      align="center"
      justify="center"
      gap={1.5}
      minH="160px"
      transition="all 0.15s ease"
      _hover={{ bg: 'neutral.50' }}
    >
      <Text as="span" textStyle="text/xl" color="neutral.300" fontWeight="light">
        +
      </Text>
      <Text as="span" textStyle="text/sm" color="neutral.300">
        Add account
      </Text>
    </Flex>
  )
}

function EmptyHoldings({ onAdd }: { onAdd: () => void }): JSX.Element {
  return (
    <Stack align="center" textAlign="center" py={16} gap={4}>
      <Box w={16} h={16} borderRadius="full" bg="neutral.50" />
      <Text as="h2" textStyle="text/lg" fontWeight="semibold" color="neutral.900">
        No accounts connected yet
      </Text>
      <Text color="neutral.400" maxW="md">
        Connect a wallet or exchange to see your Bitcoin balance and start verifying your ownership.
      </Text>
      <Button
        mt={4}
        bg="neutral.900"
        color="shades.0"
        fontWeight="semibold"
        borderRadius="8px"
        onClick={onAdd}
        _hover={{ bg: 'neutral.700' }}
      >
        Add Your First Account
      </Button>
    </Stack>
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

const exchangeConfig = {
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
} satisfies Record<string, ExchangeConfig>

function ExchangeAccountCard({ account, totalBtcSats, btcUsdPrice }: ExchangeAccountCardProps): JSX.Element {
  const needsReconnect = needsExchangeReconnect(account)
  const btc = account.balance === null || needsReconnect ? null : Number(account.balance) / 100_000_000
  const config = getRecordValue(exchangeConfig, account.exchange) ?? defaultExchangeConfig

  return (
    <AccountCardFrame
      to={`${config.detailsPath}/${account.id}`}
      name={account.displayName}
      muted={needsReconnect}
      badges={
        <StatusBadge
          status={needsReconnect ? 'error' : 'success'}
          label={needsReconnect ? 'Reconnect needed' : 'Connected'}
          size="sm"
          ml="auto"
        />
      }
      icon={
        <Flex justify="center" align="center" h="30px" my={2}>
          <img
            src={config.logo}
            alt={config.logoAlt}
            style={{
              height: '30px',
              opacity: needsReconnect ? 0.55 : 1,
              filter: needsReconnect ? 'grayscale(1)' : 'none',
            }}
          />
        </Flex>
      }
      balanceSats={btc === null ? 0 : Number(account.balance)}
      totalBtcSats={totalBtcSats}
    >
      {!needsReconnect && account.balance === null ? (
        <CardBalancePlaceholder />
      ) : (
        <CardBalance btc={btc} usd={btc !== null && btcUsdPrice !== null ? btc * btcUsdPrice : null} />
      )}
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
  const btcSats = account.balance ? Number(account.balance) : 0
  const btc = btcSats / 100_000_000

  return (
    <AccountCardFrame
      to={`${linkPrefix}/${account.id}`}
      name={account.displayName}
      badges={<StatusBadge status="warning" label="Manually Added" size="sm" ml="auto" />}
      icon={
        <Flex justify="center" align="center" h="30px" my={2}>
          <ManualNoteIcon />
        </Flex>
      }
      balanceSats={btcSats}
      totalBtcSats={totalBtcSats}
    >
      <CardBalance btc={btc} usd={btcUsdPrice !== null ? btc * btcUsdPrice : null} />
    </AccountCardFrame>
  )
}

function ManualNoteIcon(): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" w={7} h={7} color="warning.500" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <polyline
        points="14 2 14 8 20 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <polyline
        points="10 9 9 9 8 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Icon>
  )
}

function VerifiedBadge(): JSX.Element {
  return (
    <Icon viewBox="0 0 14 14" w="14px" h="14px" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="#4CAF50" />
      <path d="M4 7.2L6 9.2L10 5.2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  )
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
        borderColor="neutral.200"
        bg="neutral.50"
      >
        <Flex align="center" gap={3} minW={0}>
          <ClaimCardKeystores keystores={cardProps.keystores} alt={claim.displayName} status={cardProps.status} />
          <Text textStyle="text/sm" fontWeight="medium" color="neutral.900" isTruncated>
            {claim.displayName}
          </Text>
        </Flex>
        <HStack gap={2} justify="flex-end" flexShrink={0}>
          <Button color="error.600" variant="ghost" size="sm" onClick={onOpen} isDisabled={isRestoreDisabled}>
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
