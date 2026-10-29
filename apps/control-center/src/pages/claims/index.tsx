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
  Icon,
  Skeleton,
  Stack,
  Text,
  useDisclosure,
} from '@chakra-ui/react'
import { getRecordValue } from '@hoseki/packages/lib'
import {
  EmptyView,
  ErrorBanner,
  SkeletonRegion,
  TextSkeleton,
  useRevealAfterLoading,
} from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { ClaimCardKeystores, StatusBadge, getBadgeConfigForClaim } from '@hoseki/packages/ui/prove-verify-ui'
import { formatUsd } from '@hoseki/packages/ui/utils/format'
import { Decimal } from 'decimal.js'
import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { BitcoinAmount } from '../../components/bitcoin-amount'
import { DeleteClaimModal } from '../../components/claims/claim-details/delete-claim-modal'
import { UnavailableAlert } from '../../components/unavailable-alert'
import { SyncIndicator } from '../../components/wallet-balances/sync-indicator'
import { formatBitcoinNumber, isUsableBtcPrice } from '../../lib/bitcoin-display'
import { summarizeWalletBalances } from '../../lib/wallet-balances'
import type { ClaimDto } from '../../trpc/server-types'
import { ensureClaimStatusNotExpired, mapClaimToClaimCardProps } from '../../utils/claim-utils'
import { isExchangeConnected, needsExchangeReconnect } from '../../utils/exchange-connection-status'
import {
  type AccountsDataSource,
  type EtfAccountDto,
  type ExchangeAccountDto,
  type ManualAccountDto,
  accountsDataSource,
} from './accounts-data'

export function ClaimsPage({ dataSource = accountsDataSource }: { dataSource?: AccountsDataSource }): JSX.Element {
  dataSource.useAutoRefresh()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    claimsQuery,
    exchangeAccountsQuery,
    manualAccountsQuery,
    etfAccountsQuery,
    archivedClaimsQuery,
    btcPriceQuery,
  } = dataSource.useLists()
  const { restore, restoringId } = dataSource.useRestore()

  const claims = claimsQuery.data ?? []
  const exchangeAccounts = exchangeAccountsQuery.data ?? []
  const connectedExchangeAccounts = exchangeAccounts.filter(isExchangeConnected)
  const manualAccounts = manualAccountsQuery.data ?? []
  const etfAccounts = etfAccountsQuery.data ?? []
  const claimIds = claims.map((c) => c.id)
  const walletBalances = dataSource.useWalletBalances(claimIds, { enabled: claimIds.length > 0 })
  const accountLists = [claimsQuery, exchangeAccountsQuery, manualAccountsQuery, etfAccountsQuery]
  // Every list decides whether the page is empty, so wait for all of them rather than flash the empty state.
  const listsLoading = accountLists.some((query) => query.isLoading)
  // A list that failed to load can't show that there are no accounts, or what they add up to.
  const failedLists = accountLists.filter((query) => query.isError)
  const listsFailed = failedLists.length > 0
  const reveal = useRevealAfterLoading(listsLoading)

  useEffect(() => {
    if (location.hash !== '#archived') {
      return
    }

    const section = document.getElementById('archived')
    const toggle = document.getElementById('archived-accounts-toggle')
    const target = toggle ?? section
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
  }, [archivedClaimsQuery.data?.length, listsLoading, location.hash])

  if (listsLoading) {
    return <AccountsPageSkeleton />
  }

  const hasClaims =
    claims.length > 0 || exchangeAccounts.length > 0 || manualAccounts.length > 0 || etfAccounts.length > 0
  const verifiedCount =
    claims.filter((c) => ensureClaimStatusNotExpired(c) === 'verified').length + connectedExchangeAccounts.length
  const pendingCount = claims.filter((c) => c.status === 'pending').length

  const wallets = summarizeWalletBalances(claimIds, walletBalances.rows)
  const otherAccountsSats = [...exchangeAccounts, ...manualAccounts, ...etfAccounts].reduce(
    (sum, account) => (account.balance == null || account.balance === '' ? sum : sum + Number(account.balance)),
    0,
  )
  // A wallet or exchange balance still loading leaves the total unknown; counting it as zero would
  // show a false total and shares.
  const exchangePending = exchangeAccounts.some((account) => isExchangeConnected(account) && account.balance == null)
  const totalBtcSats = wallets.totalSats === null || exchangePending ? null : wallets.totalSats + otherAccountsSats

  const quotedBtcPrice = btcPriceQuery.data?.value ? Number(btcPriceQuery.data.value) : null
  const btcUsdPrice = isUsableBtcPrice(quotedBtcPrice) ? quotedBtcPrice : null
  // Hold a dollar line's place while the price loads; without a price there is no line.
  const usdLoading = btcPriceQuery.isLoading
  const toUsd = (sats: number): number | null => (btcUsdPrice === null ? null : (sats / 100_000_000) * btcUsdPrice)
  const totalUsd = totalBtcSats === null ? null : toUsd(totalBtcSats)

  return (
    <Box sx={reveal}>
      <Stack py={8} gap={0}>
        {/* Header */}
        <Flex align="flex-start" justify="space-between" gap={4} pb={6}>
          <Box minW={0}>
            <PageHeading
              title="Accounts"
              description={hasClaims ? undefined : 'All your Bitcoin accounts in one place.'}
            />
            {hasClaims && !listsFailed && (
              <Flex align="center" gap={3} mt={2} flexWrap="wrap">
                <Text
                  textStyle="text/sm"
                  fontWeight="semibold"
                  color="neutral.900"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {totalBtcSats === null ? (
                    <TextSkeleton width="13ch" />
                  ) : (
                    <BitcoinAmount btc={new Decimal(totalBtcSats).div(100_000_000)} />
                  )}
                </Text>
                {/* Without a price there's nothing to add up, so leave the total out rather than show $0.00. */}
                {(usdLoading || btcUsdPrice !== null) && (
                  <>
                    <Text color="neutral.200">·</Text>
                    <Text textStyle="text/sm" color="success.600" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {totalUsd === null ? <TextSkeleton width="9ch" /> : formatUsd(totalUsd)}
                    </Text>
                  </>
                )}
                {verifiedCount > 0 && (
                  <>
                    <Text color="neutral.200">·</Text>
                    <Flex align="center" gap={1}>
                      <VerifiedBadge />
                      <Text textStyle="text/sm" color="success.600">
                        {verifiedCount} Verified
                      </Text>
                    </Flex>
                  </>
                )}
                {pendingCount > 0 && (
                  <Text textStyle="text/sm" color="warning.600">
                    {pendingCount} Pending
                  </Text>
                )}
                {claimIds.length > 0 && <SyncIndicator wallets={wallets.status} />}
              </Flex>
            )}
          </Box>
          {/* The empty state has its own centered call to action. */}
          {hasClaims && (
            <Button as={Link} to="/accounts/add" flexShrink={0}>
              Add Account
            </Button>
          )}
        </Flex>

        {listsFailed && (
          <UnavailableAlert
            mb={6}
            title={hasClaims ? "Some accounts couldn't be loaded" : "Your accounts couldn't be loaded"}
            description={
              hasClaims
                ? 'The list below may be incomplete, so totals are hidden. Try again to load the rest.'
                : 'Your accounts are still saved. Try again to load them.'
            }
            onRetry={() => {
              for (const query of failedLists) {
                void query.refetch()
              }
            }}
          />
        )}

        {/* Account cards */}
        {hasClaims ? (
          <Grid templateColumns={ACCOUNT_GRID_COLUMNS} gap={4}>
            {claims.map((claim) => {
              const sats = wallets.balances.get(claim.id) ?? null
              return (
                <AccountCard
                  key={claim.id}
                  claim={claim}
                  balance={sats === null ? null : { current: new Decimal(sats), usd: toUsd(sats) }}
                  totalBtcSats={totalBtcSats}
                  isLoadingBalance={sats === null}
                  usdLoading={usdLoading}
                  hasPrice={btcUsdPrice !== null}
                />
              )
            })}
            {exchangeAccounts.map((account) => (
              <ExchangeAccountCard
                key={account.id}
                account={account}
                totalBtcSats={totalBtcSats}
                btcUsdPrice={btcUsdPrice}
                usdLoading={usdLoading}
              />
            ))}
            {manualAccounts.map((account) => (
              <ManualAccountCard
                key={account.id}
                account={account}
                totalBtcSats={totalBtcSats}
                btcUsdPrice={btcUsdPrice}
                usdLoading={usdLoading}
              />
            ))}
            {etfAccounts.map((account) => (
              <ManualAccountCard
                key={account.id}
                account={{ ...account, balance: account.balance }}
                totalBtcSats={totalBtcSats}
                btcUsdPrice={btcUsdPrice}
                usdLoading={usdLoading}
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
          !listsFailed && <EmptyHoldings />
        )}

        {/* Archived accounts accordion. It sits below the accounts, so it simply appears once loaded. */}
        <Box id="archived" mt={6} tabIndex={-1}>
          {archivedClaimsQuery.isError && (
            <Stack gap={3} align="flex-start">
              <ErrorBanner
                message={`Failed to load archived accounts: ${archivedClaimsQuery.error?.message ?? 'Unknown error'}`}
              />
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
                          restore(archivedClaim.id)
                        }}
                        isRestoring={restoringId === archivedClaim.id}
                        isRestoreDisabled={restoringId !== null}
                      />
                    ))}
                  </Stack>
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          )}
        </Box>
      </Stack>
    </Box>
  )
}

const ACCOUNT_GRID_COLUMNS = { base: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }

/** The page's outline while the account lists load: the heading, the totals line and three cards. */
function AccountsPageSkeleton(): JSX.Element {
  return (
    <SkeletonRegion label="Loading accounts">
      <Stack py={8} gap={0}>
        <Flex align="flex-start" justify="space-between" gap={4} pb={6}>
          <Box minW={0}>
            <PageHeading title="Accounts" />
            <Text textStyle="text/sm" mt={2}>
              <TextSkeleton width="30ch" />
            </Text>
          </Box>
          <Skeleton h="40px" w="132px" flexShrink={0} />
        </Flex>
        <Grid templateColumns={ACCOUNT_GRID_COLUMNS} gap={4}>
          <AccountCardSkeleton />
          <AccountCardSkeleton />
          <AccountCardSkeleton />
        </Grid>
      </Stack>
    </SkeletonRegion>
  )
}

/** An account card's outline: the badge row, logo, name, both balance lines and the share bar. */
function AccountCardSkeleton(): JSX.Element {
  return (
    <Stack borderRadius="md" border="1px solid" borderColor="neutral.200" p={2} pb={5} gap={1} textAlign="center">
      <HStack justify="flex-end">
        <Skeleton h="20px" w="72px" borderRadius="full" />
      </HStack>
      <Flex justify="center" align="center" h="30px" my={2}>
        <Skeleton boxSize="30px" borderRadius="full" />
      </Flex>
      <Text textStyle="label/md">
        <TextSkeleton width="12ch" />
      </Text>
      <CardBalanceSkeleton withUsd />
      <Flex align="center" gap={2.5} mx={4} mt={1}>
        <Box flex={1} h="3px" bg="neutral.50" borderRadius="2px" />
        <Text textStyle="label/sm">
          <TextSkeleton width="4ch" />
        </Text>
      </Flex>
    </Stack>
  )
}

export interface AccountCardProps {
  claim: ClaimDto
  balance: { current: unknown; usd: unknown } | null
  /** All accounts' total, or null while a balance in it is still unknown. */
  totalBtcSats: number | null
  isLoadingBalance: boolean
  /** The price is still loading, so the dollar line holds its place. */
  usdLoading?: boolean
  /** Whether the card will show a dollar line, so a loading balance holds its place too. */
  hasPrice?: boolean
}

export function AccountCard({
  claim,
  balance,
  totalBtcSats,
  isLoadingBalance,
  usdLoading = false,
  hasPrice = false,
}: AccountCardProps): JSX.Element {
  const isPendingMultisig = claim.keystores.length > 1 && claim.status === 'pending'
  const to = isPendingMultisig ? `/multisig/${claim.id}` : `/accounts/${claim.id}`
  const status = ensureClaimStatusNotExpired(claim)
  const cardProps = mapClaimToClaimCardProps(claim)
  const { status: badgeStatus, label: badgeLabel } = getBadgeConfigForClaim(status)

  const btcSats = balance ? Number(balance.current) : null
  const usdAmount = balance?.usd != null ? Number(balance.usd) : null
  const pct = shareOf(btcSats, totalBtcSats)

  return (
    <Stack
      as={Link}
      to={to}
      bg="shades.0"
      borderRadius="md"
      border="1px solid"
      borderColor="neutral.200"
      p={2}
      pb={5}
      cursor="pointer"
      transition="all 0.2s ease"
      gap={1}
      textAlign="center"
      _hover={{
        transform: 'translateY(-2px)',
        shadow: 'md',
      }}
    >
      {/* Top row: threshold badge + status badge */}
      <HStack>
        {claim.keystores.length > 1 && (
          <StatusBadge
            status="neutral"
            label={`${cardProps.threshold} of ${claim.keystores.length}`}
            size="sm"
            textTransform="none"
          />
        )}
        <StatusBadge status={badgeStatus} label={badgeLabel} size="sm" ml="auto" />
      </HStack>

      {/* Keystore logos */}
      <ClaimCardKeystores keystores={cardProps.keystores} alt={claim.displayName} status={status} mx="auto" />

      {/* Name */}
      <Stack gap={0} mx={4}>
        <Text textStyle="label/md" fontWeight="medium" color="neutral.600" isTruncated>
          {claim.displayName}
        </Text>
      </Stack>

      {/* Balance */}
      <Stack gap={0} mx={4} mt={1}>
        {isLoadingBalance || btcSats === null ? (
          <CardBalanceSkeleton withUsd={usdLoading || hasPrice} />
        ) : (
          <CardBalance sats={btcSats} usd={usdAmount} usdLoading={usdLoading} />
        )}
      </Stack>

      <CardShareBar pct={pct} />
    </Stack>
  )
}

/** A card's BTC balance, with its USD value when there is a price. */
function CardBalance({
  sats,
  usd,
  usdLoading = false,
}: {
  sats: number
  usd: number | null
  usdLoading?: boolean
}): JSX.Element {
  return (
    <>
      <Text textStyle="text/lg" fontWeight="semibold" color="neutral.900" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatBitcoinNumber(new Decimal(sats).div(100_000_000))}{' '}
        <Text as="span" fontWeight="medium" color="neutral.500">
          BTC
        </Text>
      </Text>
      {(usd !== null || usdLoading) && (
        <Text textStyle="text/sm" fontWeight="medium" color="success.600" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {usd === null ? <TextSkeleton width="9ch" /> : formatUsd(usd)}
        </Text>
      )}
    </>
  )
}

/** CardBalance's outline while the balance loads, in the same text styles so nothing moves. */
function CardBalanceSkeleton({ withUsd }: { withUsd: boolean }): JSX.Element {
  return (
    <>
      <Text textStyle="text/lg" fontWeight="semibold">
        <TextSkeleton width="14ch" />
      </Text>
      {withUsd && (
        <Text textStyle="text/sm" fontWeight="medium">
          <TextSkeleton width="9ch" />
        </Text>
      )}
    </>
  )
}

/** An account's share of all holdings, or null while either amount is unknown. */
function shareOf(sats: number | null, totalSats: number | null): string | null {
  if (sats === null || totalSats === null) {
    return null
  }
  return totalSats > 0 ? ((sats / totalSats) * 100).toFixed(1) : '0.0'
}

/** The account's share of all holdings: a proportion bar and its percentage. */
function CardShareBar({ pct }: { pct: string | null }): JSX.Element {
  return (
    <Flex align="center" gap={2.5} mx={4} mt={1}>
      <Box flex={1} h="3px" bg="neutral.50" borderRadius="2px" overflow="hidden">
        <Box
          h="100%"
          w={pct === null ? 0 : `${Math.max(parseFloat(pct), 1.5)}%`}
          bg="neutral.900"
          borderRadius="2px"
          opacity={0.2}
          transition="width 0.4s ease"
        />
      </Box>
      <Text textStyle="label/sm" color="neutral.500" whiteSpace="nowrap" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {pct === null ? <TextSkeleton width="4ch" /> : `${pct}%`}
      </Text>
    </Flex>
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

function EmptyHoldings(): JSX.Element {
  return (
    <EmptyView
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
      bgGradient="linear(to-b, neutral.50, shades.0)"
      title="No accounts connected yet"
      description="Connect a wallet or exchange to see your Bitcoin balance and start verifying your ownership."
      action={
        <Button as={Link} to="/accounts/add">
          Add Your First Account
        </Button>
      }
    />
  )
}

interface ExchangeAccountCardProps {
  account: ExchangeAccountDto
  totalBtcSats: number | null
  btcUsdPrice: number | null
  usdLoading: boolean
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

function ExchangeAccountCard({
  account,
  totalBtcSats,
  btcUsdPrice,
  usdLoading,
}: ExchangeAccountCardProps): JSX.Element {
  const needsReconnect = needsExchangeReconnect(account)
  const btcSats = account.balance != null && account.balance !== '' ? Number(account.balance) : 0
  const usdAmount = btcUsdPrice !== null ? (btcSats / 100_000_000) * btcUsdPrice : null
  const pct = shareOf(btcSats, totalBtcSats)

  const config = getRecordValue(exchangeConfig, account.exchange) ?? defaultExchangeConfig

  return (
    <Stack
      as={Link}
      to={`${config.detailsPath}/${account.id}`}
      bg={needsReconnect ? 'neutral.50' : 'shades.0'}
      borderRadius="md"
      border="1px solid"
      borderColor="neutral.200"
      p={2}
      pb={5}
      cursor="pointer"
      transition="all 0.2s ease"
      gap={1}
      textAlign="center"
      _hover={{
        transform: 'translateY(-2px)',
        shadow: 'md',
      }}
    >
      {/* Top row: status badge */}
      <HStack>
        <StatusBadge
          status={needsReconnect ? 'error' : 'success'}
          label={needsReconnect ? 'Reconnect' : 'Connected'}
          size="sm"
          ml="auto"
        />
      </HStack>

      {/* Exchange logo */}
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

      {/* Name */}
      <Stack gap={0} mx={4}>
        <Text
          textStyle="label/md"
          fontWeight="medium"
          color={needsReconnect ? 'neutral.400' : 'neutral.600'}
          isTruncated
        >
          {account.displayName}
        </Text>
      </Stack>

      {/* Balance */}
      <Stack gap={0} mx={4} mt={1}>
        {needsReconnect ? (
          <Text textStyle="text/lg" fontWeight="semibold" color="neutral.400">
            —
          </Text>
        ) : account.balance === null ? (
          // Not fetched from the exchange yet.
          <CardBalanceSkeleton withUsd={usdLoading || btcUsdPrice !== null} />
        ) : (
          <CardBalance sats={btcSats} usd={usdAmount} usdLoading={usdLoading} />
        )}
      </Stack>

      <CardShareBar pct={pct} />
    </Stack>
  )
}

interface ManualAccountCardProps {
  account: ManualAccountDto | EtfAccountDto
  totalBtcSats: number | null
  btcUsdPrice: number | null
  usdLoading: boolean
  linkPrefix?: string
}

function ManualAccountCard({
  account,
  totalBtcSats,
  btcUsdPrice,
  usdLoading,
  linkPrefix = '/accounts/manual',
}: ManualAccountCardProps): JSX.Element {
  const btcSats = account.balance ? Number(account.balance) : 0
  const usdAmount = btcUsdPrice !== null ? (btcSats / 100_000_000) * btcUsdPrice : null
  const pct = shareOf(btcSats, totalBtcSats)

  return (
    <Stack
      as={Link}
      to={`${linkPrefix}/${account.id}`}
      bg="shades.0"
      borderRadius="md"
      border="1px solid"
      borderColor="neutral.200"
      p={2}
      pb={5}
      cursor="pointer"
      transition="all 0.2s ease"
      gap={1}
      textAlign="center"
      _hover={{
        transform: 'translateY(-2px)',
        shadow: 'md',
      }}
    >
      {/* Top row: status badge */}
      <HStack>
        <StatusBadge status="neutral" label="Unverified" size="sm" ml="auto" />
      </HStack>

      {/* Manual icon */}
      <Flex justify="center" align="center" h="30px" my={2}>
        <ManualNoteIcon />
      </Flex>

      {/* Name */}
      <Stack gap={0} mx={4}>
        <Text textStyle="label/md" fontWeight="medium" color="neutral.600" isTruncated>
          {account.displayName}
        </Text>
      </Stack>

      {/* Balance */}
      <Stack gap={0} mx={4} mt={1}>
        <CardBalance sats={btcSats} usd={usdAmount} usdLoading={usdLoading} />
      </Stack>

      <CardShareBar pct={pct} />
    </Stack>
  )
}

function ManualNoteIcon(): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" w={7} h={7} color="neutral.600">
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
    <Icon viewBox="0 0 14 14" w="14px" h="14px" color="success.600">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
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
