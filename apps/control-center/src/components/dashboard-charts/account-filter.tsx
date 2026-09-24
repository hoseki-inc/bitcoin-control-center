import {
  Box,
  Button,
  Flex,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
  Portal,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
  useDisclosure,
  useToken,
} from '@chakra-ui/react'
import type { BalanceValue } from '@hoseki/packages/lib/balance'
import type { ClaimId } from '@hoseki/packages/schemas'
import { Check, ChevronDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import type { RouterOutput } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import { ensureClaimStatusNotExpired } from '../../utils/claim-utils'
import { needsExchangeReconnect } from '../../utils/exchange-connection-status'
import { BitcoinAmount } from '../bitcoin-amount'
import { SensitiveValue } from '../sensitive-value'
import { UsdEquivalent } from '../usd-equivalent'
import { HistorySyncStatus } from './history-sync-status'

const popoverModifiers = [{ name: 'preventOverflow', options: { altAxis: true, tether: false, padding: 16 } }]

interface AccountFilterProps {
  presentation?: 'dropdown' | 'sidebar'
  claims: ClaimDto[]
  exchangeAccounts: RouterOutput['portalProve']['exchange']['list']
  manualAccounts: RouterOutput['portalProve']['manual']['list']
  etfAccounts: RouterOutput['portalProve']['etf']['list']
  balances: Map<ClaimId, BalanceValue | null>
  btcPrice: number | null
  selected: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  historySyncingAccountIds: string[]
  recentlySyncedAccountIds: string[]
}

export function AccountFilter({
  presentation = 'dropdown',
  claims,
  exchangeAccounts,
  manualAccounts,
  etfAccounts,
  balances,
  btcPrice,
  selected,
  onSelectionChange,
  historySyncingAccountIds,
  recentlySyncedAccountIds,
}: AccountFilterProps): JSX.Element {
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem('hoseki:sidebar-compact') !== 'false'
    } catch {
      return true
    }
  })
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const accounts = [
    ...claims.map((claim) => ({
      id: claim.id,
      name: claim.displayName || claim.officialName,
      detail: ensureClaimStatusNotExpired(claim) === 'pending' ? 'Self-custody · Pending' : 'Self-custody',
      reconnectTo: null,
      sats: Number(balances.get(claim.id)?.current ?? 0),
    })),
    ...exchangeAccounts.map((account) => ({
      id: account.id,
      name: account.displayName,
      detail: needsExchangeReconnect(account) ? `${account.exchange} · Reconnect needed` : account.exchange,
      reconnectTo: needsExchangeReconnect(account) ? `/accounts/${account.exchange}/${account.id}` : null,
      sats: needsExchangeReconnect(account) ? 0 : Number(account.balance ?? 0),
    })),
    ...manualAccounts.map((account) => ({
      id: account.id,
      name: account.displayName,
      detail: 'Manual account',
      reconnectTo: null,
      sats: Number(account.balance),
    })),
    ...etfAccounts.map((account) => ({
      id: account.id,
      name: account.displayName,
      detail: 'ETF',
      reconnectTo: null,
      sats: Number(account.balance),
    })),
  ]
  const selectable = accounts.filter((account) => account.reconnectTo === null)
  const totalSats = accounts.reduce((total, account) => total + account.sats, 0)
  const included = selectable.filter((account) => selected.size === 0 || selected.has(account.id))
  const isAll = selected.size === 0
  const label = isAll
    ? 'All accounts'
    : included.length === 1
      ? (included[0]?.name ?? 'Account')
      : `${included.length} accounts`
  const matching = accounts.filter((account) =>
    `${account.name} ${account.detail}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const toggleAccount = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onSelectionChange(next)
  }
  const rows = (
    <Stack spacing={2}>
      {matching.map((account) =>
        account.reconnectTo !== null ? (
          <Flex
            as={Link}
            to={account.reconnectTo}
            key={account.id}
            direction="column"
            p={3}
            gap={1}
            borderRadius="control"
            border="1px solid"
            borderColor="border.subtle"
            _hover={{ bg: 'surface.subtle' }}
            aria-label={`Reconnect ${account.name}`}
          >
            <Text textStyle="text/sm" fontWeight="medium" overflowWrap="anywhere">
              {account.name}
            </Text>
            <Text textStyle="text/xs" color="status.warning.fg">
              Reconnect needed
            </Text>
          </Flex>
        ) : (
          <Box key={account.id} position="relative">
            <Box
              as="button"
              type="button"
              w="full"
              textAlign="left"
              aria-label={`Include ${account.name}`}
              aria-pressed={selected.has(account.id)}
              onClick={() => {
                toggleAccount(account.id)
              }}
              p={3}
              position="relative"
              borderRadius="control"
              border="1px solid"
              borderColor={selected.has(account.id) ? 'border.inverse' : 'border.subtle'}
              bg={selected.has(account.id) ? 'surface.subtle' : 'surface.raised'}
              cursor="pointer"
              _hover={{ bg: 'surface.subtle', borderColor: 'border.strong' }}
              _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '2px' }}
              transition="background-color 120ms ease, border-color 120ms ease"
              sx={{ '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}
            >
              <Flex align="flex-start" gap={2}>
                <Text
                  as="span"
                  flex="1"
                  minW={0}
                  textStyle="text/sm"
                  fontWeight="medium"
                  color="text.primary"
                  overflowWrap="anywhere"
                >
                  {account.name}
                </Text>
                <Box as="span" pt={0.5}>
                  <HistorySyncStatus
                    syncing={historySyncingAccountIds.includes(account.id)}
                    synced={recentlySyncedAccountIds.includes(account.id)}
                    compact
                  />
                </Box>
                <Box
                  as="span"
                  pt={0.5}
                  flexShrink={0}
                  color="text.primary"
                  aria-hidden="true"
                  opacity={selected.has(account.id) ? 1 : 0}
                >
                  <Check size={14} strokeWidth={2} />
                </Box>
              </Flex>
              {!compact && (
                <Text as="span" display="block" textStyle="text/xs" color="text.secondary" mt={1}>
                  {account.detail}
                </Text>
              )}
              <Text
                as="span"
                display="block"
                mt={compact ? 1 : 3}
                textStyle={compact ? 'text/xs' : 'text/sm'}
                color="text.secondary"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
                overflowWrap="anywhere"
              >
                <SensitiveValue>
                  <BitcoinAmount btc={account.sats / 100_000_000} />
                </SensitiveValue>
              </Text>
              {!compact && (
                <Flex mt={1} pr={8} minH="20px" align="center" color="text.secondary">
                  <Text as="span" textStyle="text/xs" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    <SensitiveValue>
                      <UsdEquivalent btc={account.sats / 100_000_000} btcPrice={btcPrice} />
                    </SensitiveValue>
                  </Text>
                </Flex>
              )}
            </Box>
            {!compact && (
              <Box position="absolute" bottom={3} right={3}>
                <SensitiveValue>
                  <AccountSharePie sats={account.sats} totalSats={totalSats} name={account.name} />
                </SensitiveValue>
              </Box>
            )}
          </Box>
        ),
      )}
      {matching.length === 0 && (
        <Text textStyle="text/sm" color="text.secondary" p={3}>
          No accounts match your search.
        </Text>
      )}
    </Stack>
  )
  const allAccounts = (
    <Button
      w="full"
      justifyContent="space-between"
      size="sm"
      minH="44px"
      variant="outline"
      aria-pressed={isAll}
      borderColor={isAll ? 'border.inverse' : 'border.subtle'}
      bg={isAll ? 'surface.subtle' : 'surface.raised'}
      onClick={() => {
        onSelectionChange(new Set())
      }}
    >
      All accounts
      <Box as="span" opacity={isAll ? 1 : 0} aria-hidden="true">
        <Check size={14} />
      </Box>
    </Button>
  )
  const densityControl = (
    <Flex
      as="fieldset"
      border="none"
      m={0}
      minW={0}
      aria-label="Account detail level"
      gap={1}
      p={1}
      bg="surface.subtle"
      borderRadius="control"
    >
      {([true, false] as const).map((isCompact) => (
        <Button
          key={String(isCompact)}
          flex="1"
          size="sm"
          minH="40px"
          variant="ghost"
          border="none"
          aria-label={isCompact ? 'Compact view' : 'Detailed view'}
          aria-pressed={compact === isCompact}
          bg={compact === isCompact ? 'surface.emphasis' : 'transparent'}
          color={compact === isCompact ? 'text.primary' : 'text.secondary'}
          textStyle="text/xs"
          fontWeight="medium"
          onClick={() => {
            setCompact(isCompact)
            try {
              localStorage.setItem('hoseki:sidebar-compact', String(isCompact))
            } catch {
              /* Keep session preference. */
            }
          }}
        >
          {isCompact ? 'Compact' : 'Detailed'}
        </Button>
      ))}
    </Flex>
  )
  const searchInput = (
    <Input
      ref={searchRef}
      size="sm"
      h="40px"
      aria-label="Search accounts"
      placeholder="Search accounts"
      value={search}
      onChange={(event) => {
        setSearch(event.target.value)
      }}
    />
  )
  const count = (
    <Text textStyle="text/xs" color="text.secondary" aria-live="polite">
      {included.length} of {selectable.length}
    </Text>
  )

  if (presentation === 'sidebar') {
    return (
      <Box
        as="aside"
        aria-label="Portfolio accounts"
        w="280px"
        flexShrink={0}
        position="sticky"
        top={0}
        alignSelf="flex-start"
        minH="var(--shell-viewport-height, calc(100dvh - 76px))"
        maxH="var(--shell-viewport-height, calc(100dvh - 76px))"
        overflowY="auto"
        borderRight="1px solid"
        borderColor="border.subtle"
        px={4}
        py={8}
        sx={{ scrollbarGutter: 'stable', overscrollBehavior: 'contain' }}
      >
        <Stack spacing={3}>
          <Flex align="center" justify="space-between" gap={2}>
            <Text textStyle="text/md" fontWeight="medium">
              Accounts
            </Text>
            {count}
          </Flex>
          {densityControl}
          {searchInput}
          {allAccounts}
          {rows}
          <Button as={Link} to="/accounts" variant="ghost" size="sm" minH="44px" justifyContent="flex-start">
            Manage accounts
          </Button>
        </Stack>
      </Box>
    )
  }
  return (
    <Popover
      isOpen={isOpen}
      onOpen={() => {
        setSearch('')
        onOpen()
      }}
      onClose={onClose}
      initialFocusRef={searchRef}
      placement="bottom-start"
      strategy="fixed"
      modifiers={popoverModifiers}
      isLazy
    >
      <PopoverTrigger>
        <Button
          variant="outline"
          maxW="100%"
          rightIcon={<ChevronDown size={16} />}
          aria-label={`Filter accounts: ${label}`}
        >
          <Text as="span" isTruncated maxW={{ base: '200px', md: '320px' }}>
            {label}
          </Text>
        </Button>
      </PopoverTrigger>
      <Portal>
        <PopoverContent
          w="360px"
          maxW="calc(100vw - 32px)"
          maxH="min(600px, calc(100dvh - 32px))"
          borderRadius="panel"
          overflow="hidden"
        >
          <PopoverHeader p={4} borderColor="border.subtle" flexShrink={0}>
            <Stack spacing={3}>
              <Flex justify="space-between" align="center">
                <Text textStyle="text/md" fontWeight="medium">
                  Accounts
                </Text>
                {count}
              </Flex>
              {searchInput}
              {allAccounts}
            </Stack>
          </PopoverHeader>
          <PopoverBody p={3} overflowY="auto" minH={0}>
            {rows}
          </PopoverBody>
          <PopoverFooter p={3} borderColor="border.subtle" flexShrink={0}>
            <Flex justify="space-between">
              <Button as={Link} to="/accounts" variant="ghost" size="sm">
                Manage accounts
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Done
              </Button>
            </Flex>
          </PopoverFooter>
        </PopoverContent>
      </Portal>
    </Popover>
  )
}

function formatShare(sats: number, totalSats: number): string {
  const percentage = totalSats > 0 ? Math.min(100, Math.max(0, (sats / totalSats) * 100)) : 0
  return percentage > 0 && percentage < 0.1 ? '<0.1' : percentage.toFixed(1)
}

function AccountSharePie({ sats, totalSats, name }: { sats: number; totalSats: number; name: string }): JSX.Element {
  const percentage = totalSats > 0 ? Math.min(100, Math.max(0, (sats / totalSats) * 100)) : 0
  const [fill, track] = useToken('colors', ['chart.axis', 'surface.muted'])
  const label = `${formatShare(sats, totalSats)}% of your portfolio`
  return (
    <>
      <Tooltip label={label} placement="top" hasArrow>
        <Box
          as="span"
          aria-hidden="true"
          display="block"
          boxSize="20px"
          borderRadius="full"
          background={`conic-gradient(${fill} ${percentage}%, ${track} 0)`}
        />
      </Tooltip>
      {/* Read as text beside the row rather than being a separate focus stop. */}
      <VisuallyHidden>{`${name}: ${label}`}</VisuallyHidden>
    </>
  )
}
