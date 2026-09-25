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
  IconButton,
  Stack,
  Text,
  useDisclosure,
} from '@chakra-ui/react'
import { getRecordValue } from '@hoseki/packages/lib'
import { EmptyView, Spinner } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { ClaimCardKeystores, getBadgeConfigForClaim } from '@hoseki/packages/ui/prove-verify-ui'
import { ChartNoAxesCombined, FileText, LayoutGridIcon, ListIcon, Plus } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { BitcoinAmount } from '../../components/bitcoin-amount'
import { DeleteClaimModal } from '../../components/claims/claim-details/delete-claim-modal'
import { FiatAmountText } from '../../components/fiat-amount-text'
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
        <PageHeading title="Accounts" description="Your wallets and exchange accounts." />
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
        <Flex align="flex-start" justify="space-between" pb={6} gap={4} flexWrap="wrap">
          <Box>
            <PageHeading title="Accounts" description="Manage your wallets, exchanges, and Bitcoin holdings." />
          </Box>
          {hasClaims && (
            <Button
              onClick={() => {
                void navigate('/accounts/add')
              }}
            >
              Add Account
            </Button>
          )}
        </Flex>

        {hasClaims && (
          <Flex align="center" justify="space-between" gap={4} flexWrap="wrap" mb={6}>
            <Flex align="baseline" gap={3} flexWrap="wrap" minW={0}>
              <Text
                textStyle={{ base: 'amount/compact', md: 'amount/primary' }}
                fontWeight="medium"
                color="neutral.900"
                fontFamily="body"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
                overflowWrap="anywhere"
              >
                <>{hasUnknownBalance ? '—' : <BitcoinAmount btc={totalBtc.toFixed(8)} />}</>
              </Text>
              <FiatAmountText primary>
                <>
                  {hasUnknownBalance
                    ? 'Some balances are unavailable'
                    : btcUsdPrice === null
                      ? 'USD unavailable'
                      : totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </>
              </FiatAmountText>
            </Flex>
            <Flex align="center" gap={3} flexWrap="wrap" aria-label="Account verification status">
              {claims.length > 0 && (
                <Flex align="center" gap={1.5}>
                  {verifiedCount > 0 && <VerifiedBadge />}
                  <Text textStyle="text/sm" color={verifiedCount > 0 ? 'success.700' : 'neutral.500'}>
                    {verifiedCount === 0 ? 'No verified wallets' : `${verifiedCount} verified wallets`}
                  </Text>
                </Flex>
              )}
              {connectedExchangeAccounts.length > 0 && (
                <Text textStyle="text/sm" color="neutral.600">
                  {connectedExchangeAccounts.length} connected exchanges
                </Text>
              )}
              {pendingCount > 0 && (
                <Text textStyle="text/sm" color="warning.700">
                  {pendingCount} pending
                </Text>
              )}
            </Flex>
            <Flex justify="flex-end" gap={1} flexShrink={0} as="fieldset" aria-label="Account view">
              <IconButton
                aria-label="List view"
                aria-pressed={view === 'list'}
                icon={<ListIcon size={18} />}
                variant={view === 'list' ? 'outline' : 'ghost'}
                onClick={() => {
                  setView('list')
                }}
              />
              <IconButton
                aria-label="Card view"
                aria-pressed={view === 'cards'}
                icon={<LayoutGridIcon size={18} />}
                variant={view === 'cards' ? 'outline' : 'ghost'}
                onClick={() => {
                  setView('cards')
                }}
              />
            </Flex>
          </Flex>
        )}

        {/* Account cards */}
        {hasClaims ? (
          view === 'list' ? (
            <Stack spacing={0} borderTop="1px solid" borderColor="neutral.200">
              {claims.map((claim) => (
                <AccountRow
                  key={claim.id}
                  name={claim.displayName}
                  to={
                    claim.keystores.length > 1 && claim.status === 'pending'
                      ? `/multisig/${claim.id}`
                      : `/accounts/${claim.id}`
                  }
                  detail={getBadgeConfigForClaim(ensureClaimStatusNotExpired(claim)).label}
                  sats={balancesQuery.data.get(claim.id)?.current.toString() ?? null}
                  btcPrice={btcUsdPrice}
                />
              ))}
              {exchangeAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  name={account.displayName}
                  to={`${(getRecordValue(exchangeConfig, account.exchange) ?? defaultExchangeConfig).detailsPath}/${account.id}`}
                  detail={`${(getRecordValue(exchangeConfig, account.exchange) ?? defaultExchangeConfig).label} · ${isExchangeConnected(account) ? 'Connected' : 'Reconnect needed'}`}
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
              templateColumns={{ base: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }}
              gap={4}
            >
              {claims.map((claim) => (
                <AccountCard
                  key={claim.id}
                  claim={claim}
                  balance={balancesQuery.data.get(claim.id) ?? null}
                  isLoadingBalance={balancesQuery.isLoading}
                />
              ))}
              {exchangeAccounts.map((account) => (
                <ExchangeAccountCard key={account.id} account={account} btcUsdPrice={btcUsdPrice} />
              ))}
              {manualAccounts.map((account) => (
                <ManualAccountCard key={account.id} account={account} btcUsdPrice={btcUsdPrice} />
              ))}
              {etfAccounts.map((account) => (
                <ManualAccountCard
                  key={account.id}
                  account={{ ...account, balance: account.balance }}
                  btcUsdPrice={btcUsdPrice}
                  linkPrefix="/accounts/etf"
                />
              ))}
              <AddAccountTile view="cards" />
            </Grid>
          )
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

function AccountCardFrame({
  to,
  name,
  detail,
  icon,
  children,
}: {
  to: string
  name: string
  detail: ReactNode
  icon: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <Stack
      as={Link}
      to={to}
      bg="shades.0"
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
      p={5}
      gap={6}
      minW={0}
      textAlign="left"
      transition="border-color 150ms ease, background-color 150ms ease"
      _hover={{ borderColor: 'neutral.400', bg: 'neutral.50' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '3px' }}
    >
      <Flex align="flex-start" gap={3}>
        <Box flex={1} minW={0}>
          <Text textStyle="text/md" fontWeight="medium" color="neutral.900" overflowWrap="anywhere">
            {name}
          </Text>
          <Text textStyle="text/xs" color="neutral.600" mt={1}>
            {detail}
          </Text>
        </Box>
        <Flex align="center" justify="center" flexShrink={0} color="neutral.600" aria-hidden="true">
          {icon}
        </Flex>
      </Flex>
      <Box mt="auto" minW={0} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {children}
      </Box>
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
  if (loading) {
    return (
      <Text as="output" display="block" textStyle="text/sm" color="neutral.600">
        Loading balance…
      </Text>
    )
  }
  return (
    <>
      <Text textStyle="text/xl" fontWeight="medium" color="neutral.900" letterSpacing="-0.02em" overflowWrap="anywhere">
        <>{btc === null ? '—' : <BitcoinAmount btc={btc.toFixed(8)} />}</>
      </Text>
      <FiatAmountText mt={1}>
        <>
          {btc === null
            ? 'Balance unavailable'
            : usd === null
              ? 'USD unavailable'
              : usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </>
      </FiatAmountText>
    </>
  )
}

interface AccountCardProps {
  claim: ClaimDto
  balance: { current: unknown; usd: unknown } | null
  isLoadingBalance: boolean
}

function AccountCard({ claim, balance, isLoadingBalance }: AccountCardProps): JSX.Element {
  const isPendingMultisig = claim.keystores.length > 1 && claim.status === 'pending'
  const status = ensureClaimStatusNotExpired(claim)
  const cardProps = mapClaimToClaimCardProps(claim)
  return (
    <AccountCardFrame
      to={isPendingMultisig ? `/multisig/${claim.id}` : `/accounts/${claim.id}`}
      name={claim.displayName}
      detail={
        <>
          {claim.keystores.length > 1 ? `${cardProps.threshold} of ${claim.keystores.length} · ` : ''}
          {getBadgeConfigForClaim(status).label}
        </>
      }
      icon={<ClaimCardKeystores keystores={cardProps.keystores} alt="" status={status} />}
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
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
      bgGradient="linear(to-b, neutral.50, white)"
      title="Your Bitcoin, in one place"
      description="Connect a wallet or exchange to see your Bitcoin balance and start verifying your ownership."
      action={<Button onClick={onAdd}>Add Your First Account</Button>}
    />
  )
}

interface ExchangeAccountCardProps {
  account: ExchangeAccountDto
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

function ExchangeAccountCard({ account, btcUsdPrice }: ExchangeAccountCardProps): JSX.Element {
  const needsReconnect = needsExchangeReconnect(account)
  const btc = account.balance === null || needsReconnect ? null : Number(account.balance) / 100_000_000
  const config = getRecordValue(exchangeConfig, account.exchange) ?? defaultExchangeConfig
  return (
    <AccountCardFrame
      to={`${config.detailsPath}/${account.id}`}
      name={account.displayName}
      detail={
        <>
          {config.label} ·{' '}
          <Box as="span" color={needsReconnect ? 'error.700' : undefined}>
            {needsReconnect ? 'Reconnect needed' : 'Connected'}
          </Box>
        </>
      }
      icon={<Box as="img" src={config.logo} alt="" maxW="64px" h={6} objectFit="contain" />}
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
  btcUsdPrice: number | null
  linkPrefix?: string
}

function ManualAccountCard({
  account,
  btcUsdPrice,
  linkPrefix = '/accounts/manual',
}: ManualAccountCardProps): JSX.Element {
  const btc = Number(account.balance) / 100_000_000
  const isEtf = linkPrefix === '/accounts/etf'
  return (
    <AccountCardFrame
      to={`${linkPrefix}/${account.id}`}
      name={account.displayName}
      detail={isEtf ? 'Manual ETF account' : 'Manual account'}
      icon={isEtf ? <ChartNoAxesCombined size={20} /> : <FileText size={20} />}
    >
      <AccountCardBalance btc={btc} usd={btcUsdPrice !== null ? btc * btcUsdPrice : null} />
    </AccountCardFrame>
  )
}

function VerifiedBadge(): JSX.Element {
  return (
    <Icon viewBox="0 0 14 14" w="14px" h="14px">
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
      borderColor="neutral.200"
      minW={0}
      flexWrap="wrap"
      transition="background-color 150ms ease"
      _hover={{ bg: 'neutral.50' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '2px' }}
    >
      <Box flex="1" minW="140px">
        <Text textStyle="text/md" fontWeight="medium" overflowWrap="anywhere">
          {name}
        </Text>
        <Text textStyle="text/sm" color="neutral.600" mt={1}>
          {detail}
        </Text>
      </Box>
      <Box textAlign="right" minW={0} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        <Text textStyle="text/lg" fontWeight="medium">
          <>{btc === null ? '—' : <BitcoinAmount btc={btc.toFixed(8)} />}</>
        </Text>
        <FiatAmountText mt={1}>
          <>
            {btc === null || btcPrice === null
              ? 'USD unavailable'
              : (btc * btcPrice).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </>
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
      borderColor="neutral.400"
      borderRadius="panel"
      transition="border-color 150ms ease, background-color 150ms ease"
      color="neutral.500"
      _hover={{ bg: 'neutral.50', borderColor: 'neutral.600' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '2px' }}
    >
      <Plus size={24} aria-hidden="true" style={{ flexShrink: 0 }} />
      <Box minW={0}>
        <Text textStyle="text/md" fontWeight="medium" color="neutral.900">
          Add account
        </Text>
        <Text textStyle="text/sm" color="neutral.600" mt={1} maxW={view === 'cards' ? '28ch' : undefined}>
          Connect a wallet or exchange, or track holdings manually.
        </Text>
      </Box>
    </Flex>
  )
}
