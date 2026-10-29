import {
  Box,
  Button,
  Flex,
  Icon,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
  chakra,
  useDisclosure,
} from '@chakra-ui/react'
import { getRecordValue } from '@hoseki/packages/lib'
import type { BalanceValue } from '@hoseki/packages/lib/balance'
import type { ClaimId } from '@hoseki/packages/schemas'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui'
import { VIEWPORT_BELOW_HEADER } from '@hoseki/packages/ui/prove-verify-ui/layout'
import { type SupportedHardwareWallet, getSupportedHardwareWalletLogoPath } from '@hoseki/packages/wallet'
import { Check, ChevronDown, KeyRound, Search } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { RouterOutput } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import { ensureClaimStatusNotExpired } from '../../utils/claim-utils'
import { needsExchangeReconnect } from '../../utils/exchange-connection-status'
import { BitcoinAmount } from '../bitcoin-amount'
import { HistorySyncStatus } from './history-sync-status'

const exchangeLogos = {
  coinbase: '/images/exchanges/coinbase.svg',
  kraken: '/images/exchanges/kraken.svg',
  robinhood: '/images/exchanges/robinhood-icon.svg',
  strike: '/images/exchanges/strike-icon.svg',
} satisfies Record<string, string>

type AccountLogo =
  | { kind: 'wallet'; wallets: (SupportedHardwareWallet | null)[] }
  | { kind: 'image'; src: string }
  | { kind: 'manual' }

const PlainButton = chakra('button')

const popoverModifiers = [{ name: 'preventOverflow', options: { altAxis: true, tether: false, padding: 16 } }]

interface AccountFilterProps {
  presentation?: 'dropdown' | 'sidebar'
  claims: ClaimDto[]
  exchangeAccounts: RouterOutput['portalProve']['exchange']['list']
  manualAccounts: RouterOutput['portalProve']['manual']['list']
  etfAccounts: RouterOutput['portalProve']['etf']['list']
  balances: Map<ClaimId, BalanceValue | null>
  /** An account list failed to load, so a total would leave accounts out. */
  isMissingAccounts?: boolean
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
  isMissingAccounts = false,
  selected,
  onSelectionChange,
  historySyncingAccountIds,
  recentlySyncedAccountIds,
}: AccountFilterProps): JSX.Element {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const allAccountsRef = useRef<HTMLButtonElement>(null)
  // An id rather than a ref: Tooltip would read the ref from its child, which React 19 warns about.
  const searchToggleId = useId()
  const [isSearching, setIsSearching] = useState(false)
  useEffect(() => {
    // Focus once the box is interactive again; it stays mounted while hidden.
    if (isSearching) {
      searchRef.current?.focus({ preventScroll: true })
    }
  }, [isSearching])
  const accounts: {
    id: string
    name: string
    /** Shown in the warning color when it needs action, otherwise in gray. */
    status: { label: string; needsAction: boolean } | null
    logo: AccountLogo
    reconnectTo: string | null
    /** Null for a wallet with neither a live nor a stored balance. */
    sats: number | null
  }[] = [
    ...claims.map((claim) => {
      return {
        id: claim.id,
        name: claim.displayName,
        status: getClaimStatus(claim),
        logo: {
          kind: 'wallet' as const,
          wallets: claim.keystores.slice(0, 3).map((keystore) => keystore.wallet ?? null),
        },
        reconnectTo: null,
        sats: toSatsOrNull(balances.get(claim.id)),
      }
    }),
    ...exchangeAccounts.map((account) => {
      const logo = getRecordValue(exchangeLogos, account.exchange)
      return {
        id: account.id,
        name: account.displayName,
        status: null,
        logo: logo === undefined ? { kind: 'manual' as const } : { kind: 'image' as const, src: logo },
        reconnectTo: needsExchangeReconnect(account) ? `/accounts/${account.exchange}/${account.id}` : null,
        sats: needsExchangeReconnect(account) ? 0 : Number(account.balance ?? 0),
      }
    }),
    ...[...manualAccounts, ...etfAccounts].map((account) => ({
      id: account.id,
      name: account.displayName,
      status: { label: 'Unverified', needsAction: false },
      logo: { kind: 'manual' as const },
      reconnectTo: null,
      sats: Number(account.balance),
    })),
  ].sort((a, b) => (b.sats ?? -1) - (a.sats ?? -1))
  const selectable = accounts.filter((account) => account.reconnectTo === null)
  // A missing account or wallet balance would understate the total and every share.
  const totalSats =
    isMissingAccounts || accounts.some((account) => account.sats === null)
      ? null
      : accounts.reduce((total, account) => total + (account.sats ?? 0), 0)
  const included = selectable.filter((account) => selected.size === 0 || selected.has(account.id))
  const isAll = selected.size === 0
  const label = isAll
    ? 'All accounts'
    : included.length === 1
      ? (included[0]?.name ?? 'Account')
      : `${included.length} accounts`
  const matching = accounts.filter((account) => account.name.toLowerCase().includes(search.trim().toLowerCase()))
  const closeSearch = (): void => {
    setIsSearching(false)
    setSearch('')
  }

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
    // Extra spacing leaves room for status badges on the cards' top edges.
    <Stack spacing={3}>
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
            borderColor="neutral.200"
            _hover={{ bg: 'neutral.50' }}
          >
            <Flex align="center" gap={2}>
              <AccountLogoMark logo={account.logo} muted />
              <Text textStyle="text/sm" fontWeight="medium" overflowWrap="anywhere">
                {account.name}
              </Text>
            </Flex>
            <Text textStyle="text/xs" color="warning.700">
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
              aria-pressed={selected.has(account.id)}
              onClick={() => {
                toggleAccount(account.id)
              }}
              p={3}
              position="relative"
              borderRadius="control"
              border="1px solid"
              borderColor={
                selected.has(account.id)
                  ? 'neutral.700'
                  : account.status?.needsAction === true
                    ? 'warning.300'
                    : 'neutral.200'
              }
              bg={selected.has(account.id) ? 'neutral.50' : 'shades.0'}
              cursor="pointer"
              _hover={{ bg: 'neutral.50', borderColor: 'neutral.600' }}
              _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '2px' }}
              transition="background-color 120ms ease, border-color 120ms ease"
              sx={{ '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}
            >
              <Flex as="span" align="center" gap={2}>
                <AccountLogoMark logo={account.logo} />
                <Text
                  as="span"
                  flex="1"
                  minW={0}
                  textStyle="text/sm"
                  fontWeight="medium"
                  color="neutral.900"
                  overflowWrap="anywhere"
                >
                  {account.name}
                </Text>
                <Box as="span">
                  <HistorySyncStatus
                    syncing={historySyncingAccountIds.includes(account.id)}
                    synced={recentlySyncedAccountIds.includes(account.id)}
                    compact
                  />
                </Box>
                <Box
                  as="span"
                  flexShrink={0}
                  color="neutral.900"
                  aria-hidden="true"
                  opacity={selected.has(account.id) ? 1 : 0}
                >
                  <Check size={14} strokeWidth={2} />
                </Box>
              </Flex>
              <Text
                as="span"
                display="block"
                mt={1}
                pr={7}
                textStyle="text/xs"
                color="neutral.600"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
                overflowWrap="anywhere"
              >
                {account.sats === null ? '\u2014' : <BitcoinAmount btc={account.sats / 100_000_000} />}
              </Text>
              {account.sats !== null && totalSats !== null && (
                <Box as="span" position="absolute" bottom={3} right={3}>
                  <AccountSharePie sats={account.sats} totalSats={totalSats} />
                </Box>
              )}
              {account.status !== null && <StatusBadge {...account.status} />}
            </Box>
          </Box>
        ),
      )}
      {matching.length === 0 && (
        <Text textStyle="text/sm" color="neutral.600" p={3}>
          No accounts match your search.
        </Text>
      )}
    </Stack>
  )
  const allAccounts = (
    <PlainButton
      ref={allAccountsRef}
      type="button"
      w="full"
      textAlign="left"
      p={3}
      aria-pressed={isAll}
      borderRadius="control"
      border="1px solid"
      borderColor={isAll ? 'neutral.700' : 'neutral.200'}
      bg={isAll ? 'neutral.50' : 'shades.0'}
      _hover={{ bg: 'neutral.50', borderColor: 'neutral.600' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '2px' }}
      onClick={() => {
        onSelectionChange(new Set())
      }}
    >
      <Flex as="span" align="center" justify="space-between" gap={2}>
        <Text as="span" textStyle="text/sm" fontWeight="medium" color="neutral.900">
          All accounts
        </Text>
        <Box as="span" opacity={isAll ? 1 : 0} aria-hidden="true">
          <Check size={14} />
        </Box>
      </Flex>
      <Text
        as="span"
        display="block"
        mt={1}
        textStyle="text/xs"
        color="neutral.600"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {totalSats === null ? '\u2014' : <BitcoinAmount btc={totalSats / 100_000_000} />}
      </Text>
    </PlainButton>
  )
  const headerControls = (
    <Flex align="center" justify="flex-end" gap={1.5}>
      {/* Always mounted so it can fade and grow in and out smoothly. */}
      <Box
        flex={isSearching ? '1' : '0'}
        minW={0}
        maxW={isSearching ? '240px' : '0px'}
        opacity={isSearching ? 1 : 0}
        transition="max-width 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms ease, flex-grow 320ms cubic-bezier(0.22, 1, 0.36, 1)"
        sx={{ '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}
        aria-hidden={!isSearching || undefined}
        {...(isSearching ? {} : { inert: true })}
      >
        <Input
          ref={searchRef}
          w="full"
          h="28px"
          px={3}
          borderRadius="full"
          border="none"
          bg="neutral.100"
          textStyle="text/sm"
          _placeholder={{ color: 'neutral.600' }}
          _focusVisible={{
            bg: 'neutral.50',
            outline: '2px solid',
            outlineColor: 'activeState.80',
            outlineOffset: '2px',
          }}
          aria-label="Search accounts"
          placeholder="Search"
          tabIndex={isSearching ? undefined : -1}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              // Move focus out before the box becomes inert, or it falls to the page.
              document.getElementById(searchToggleId)?.focus()
              closeSearch()
            }
          }}
        />
      </Box>
      <HeaderIconButton
        id={searchToggleId}
        label="Search accounts"
        isActive={isSearching}
        onClick={() => {
          if (isSearching) {
            closeSearch()
          } else {
            setIsSearching(true)
          }
        }}
      >
        <Search size={13} strokeWidth={2} />
      </HeaderIconButton>
    </Flex>
  )
  // Clear sits left of the count, so the count never moves when it appears.
  const count = (
    <Flex align="center" gap={2}>
      {!isAll && (
        <PlainButton
          type="button"
          aria-label="Clear account filter"
          onClick={() => {
            onSelectionChange(new Set())
            // This button goes away, so keep focus on the choice it made.
            allAccountsRef.current?.focus()
          }}
          px={1.5}
          borderRadius="4px"
          textStyle="text/xs"
          fontWeight="medium"
          color="neutral.700"
          _hover={{ color: 'neutral.900', bg: 'neutral.100' }}
          _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '2px' }}
        >
          Clear
        </PlainButton>
      )}
      <Text textStyle="text/xs" color="neutral.600">
        {included.length} of {selectable.length}
      </Text>
    </Flex>
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
        minH={VIEWPORT_BELOW_HEADER}
        maxH={VIEWPORT_BELOW_HEADER}
        overflowY="auto"
        borderRight="1px solid"
        borderColor="neutral.200"
        px={4}
        py={8}
        sx={{ scrollbarGutter: 'stable', overscrollBehavior: 'contain' }}
      >
        <Stack spacing={3}>
          {headerControls}
          <Flex align="center" justify="space-between" gap={2}>
            <Text as="h2" textStyle="text/md" fontWeight="medium">
              Accounts
            </Text>
            {count}
          </Flex>
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
        closeSearch()
        onOpen()
      }}
      onClose={onClose}
      // The search box is hidden until opened, and focusing an icon button would pop its tooltip.
      initialFocusRef={allAccountsRef}
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
        {/* Plain sections rather than Popover parts, which would name the dialog with the whole header and list. */}
        <PopoverContent
          aria-label="Accounts"
          w="360px"
          maxW="calc(100vw - 32px)"
          maxH="min(600px, calc(100dvh - 32px))"
          borderRadius="panel"
          overflow="hidden"
        >
          <Box p={4} borderBottom="1px solid" borderColor="neutral.200" flexShrink={0}>
            <Stack spacing={3}>
              {headerControls}
              <Flex justify="space-between" align="center" gap={2}>
                <Text textStyle="text/md" fontWeight="medium">
                  Accounts
                </Text>
                {count}
              </Flex>
              {allAccounts}
            </Stack>
          </Box>
          <Box p={3} overflowY="auto" minH={0}>
            {rows}
          </Box>
          <Box p={3} borderTop="1px solid" borderColor="neutral.200" flexShrink={0}>
            <Flex justify="space-between">
              <Button as={Link} to="/accounts" variant="ghost" size="sm">
                Manage accounts
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Done
              </Button>
            </Flex>
          </Box>
        </PopoverContent>
      </Portal>
    </Popover>
  )
}

function formatShare(sats: number, totalSats: number): string {
  const percentage = totalSats > 0 ? Math.min(100, Math.max(0, (sats / totalSats) * 100)) : 0
  return percentage > 0 && percentage < 0.1 ? '<0.1' : percentage.toFixed(1)
}

function AccountSharePie({ sats, totalSats }: { sats: number; totalSats: number }): JSX.Element {
  const percentage = totalSats > 0 ? Math.min(100, Math.max(0, (sats / totalSats) * 100)) : 0
  const size = 16
  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  // A sliver stays visible for tiny accounts, so only an empty one has an empty ring.
  const filled = sats > 0 && totalSats > 0 ? (Math.max(percentage, 0.5) / 100) * circumference : 0
  const label = `${formatShare(sats, totalSats)}% of your portfolio`
  return (
    <Tooltip label={label} placement="top" hasArrow>
      <Box as="span" display="block" boxSize={`${size}px`} color="neutral.900">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            opacity={0.1}
          />
          {filled > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeDasharray={`${filled} ${circumference - filled}`}
              strokeLinecap="round"
              opacity={0.4}
            />
          )}
        </svg>
        <VisuallyHidden>{label}</VisuallyHidden>
      </Box>
    </Tooltip>
  )
}

function toSatsOrNull(balance: BalanceValue | null | undefined): number | null {
  return balance === null || balance === undefined ? null : Number(balance.current)
}

/** Decorative, as the account's name sits beside it. */
function AccountLogoMark({ logo, muted = false }: { logo: AccountLogo; muted?: boolean }): JSX.Element {
  const size = '20px'
  const style = muted ? { opacity: 0.55, filter: 'grayscale(1)' } : undefined
  if (logo.kind === 'image') {
    return (
      <Box
        as="span"
        display="block"
        boxSize={size}
        flexShrink={0}
        borderRadius="6px"
        overflow="hidden"
        sx={style}
        aria-hidden="true"
      >
        <img src={logo.src} alt="" width="100%" height="100%" />
      </Box>
    )
  }
  if (logo.kind === 'manual') {
    return (
      <Flex
        as="span"
        boxSize={size}
        flexShrink={0}
        borderRadius="6px"
        bg="neutral.100"
        align="center"
        justify="center"
        aria-hidden="true"
      >
        <ManualNoteIcon boxSize="12px" />
      </Flex>
    )
  }
  if (logo.wallets.length > 1) {
    const mini = '12px'
    const positions = [
      { top: 0, left: '50%', transform: 'translateX(-50%)' },
      { bottom: 0, left: 0 },
      { bottom: 0, right: 0 },
    ]
    return (
      <Box as="span" display="block" position="relative" boxSize={size} flexShrink={0} aria-hidden="true">
        {logo.wallets.map((wallet, index) => (
          <Box as="span" key={index} display="block" position="absolute" {...positions[index]}>
            {wallet === null ? (
              // An unknown signing device gets a neutral key rather than a Bitcoin coin.
              <Flex
                as="span"
                boxSize={mini}
                borderRadius="full"
                bg="neutral.100"
                border="1px solid"
                borderColor="shades.0"
                align="center"
                justify="center"
                color="neutral.500"
              >
                <KeyRound size={7} strokeWidth={2.5} />
              </Flex>
            ) : (
              <KeystoreAvatar size={mini} src={getSupportedHardwareWalletLogoPath(wallet)} alt="" />
            )}
          </Box>
        ))}
      </Box>
    )
  }
  return (
    <KeystoreAvatar
      variant="contained"
      size={size}
      src={getSupportedHardwareWalletLogoPath(logo.wallets[0] ?? null)}
      alt=""
      flexShrink={0}
      aria-hidden="true"
    />
  )
}

function HeaderIconButton({
  id,
  label,
  isActive,
  onClick,
  children,
}: {
  id?: string
  label: string
  /** A pressed state, for buttons that toggle on and off under one name. */
  isActive?: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <Tooltip label={label} openDelay={300} hasArrow>
      <PlainButton
        id={id}
        type="button"
        aria-label={label}
        aria-pressed={isActive}
        onClick={onClick}
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize="28px"
        borderRadius="6px"
        border="1px solid"
        borderColor={isActive === true ? 'neutral.500' : 'neutral.200'}
        color={isActive === true ? 'neutral.900' : 'neutral.600'}
        bg="shades.0"
        _hover={{ bg: 'neutral.50', borderColor: 'neutral.300', color: 'neutral.900' }}
        _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '2px' }}
      >
        {children}
      </PlainButton>
    </Tooltip>
  )
}

function ManualNoteIcon({ boxSize }: { boxSize: string }): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" color="neutral.600" boxSize={boxSize} aria-hidden="true">
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
    </Icon>
  )
}

function getClaimStatus(claim: ClaimDto): { label: string; needsAction: boolean } | null {
  switch (ensureClaimStatusNotExpired(claim)) {
    case 'pending':
      return { label: 'Pending', needsAction: true }
    case 'unverified':
      return { label: 'Unverified', needsAction: false }
    case 'verified':
    case 'expired':
      return null
  }
}

function StatusBadge({ label, needsAction }: { label: string; needsAction: boolean }): JSX.Element {
  return (
    <Text
      as="span"
      position="absolute"
      top="-9px"
      left="50%"
      transform="translateX(-50%)"
      px={2}
      bg={needsAction ? 'warning.50' : 'neutral.50'}
      border="1px solid"
      borderColor={needsAction ? 'warning.300' : 'neutral.300'}
      borderRadius="full"
      whiteSpace="nowrap"
      textStyle="label/xs"
      fontWeight="semibold"
      color={needsAction ? 'warning.700' : 'neutral.600'}
      pointerEvents="none"
    >
      {label}
    </Text>
  )
}
