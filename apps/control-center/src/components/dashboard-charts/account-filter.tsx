import {
  Box,
  Button,
  Checkbox,
  Flex,
  IconButton,
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
  useDisclosure,
} from '@chakra-ui/react'
import type { BalanceValue } from '@hoseki/packages/lib/balance'
import type { ClaimId } from '@hoseki/packages/schemas'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import type { RouterOutput } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import { ensureClaimStatusNotExpired } from '../../utils/claim-utils'
import { needsExchangeReconnect } from '../../utils/exchange-connection-status'
import { BitcoinAmount } from '../bitcoin-amount'
import { UsdEquivalent } from '../usd-equivalent'
import { HistorySyncStatus } from './history-sync-status'

const MotionBox = motion.create(Box)

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
  const reduceMotion = useReducedMotion()
  const [collapsed, setCollapsed] = useState(false)
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem('hoseki:sidebar-compact') !== 'false'
    } catch {
      return true
    }
  })
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const accounts = [
    ...claims.map((claim) => ({
      id: claim.id,
      name: claim.displayName,
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
  const isAll = included.length === selectable.length
  const label = isAll
    ? 'All accounts'
    : included.length === 1
      ? (included[0]?.name ?? 'Account')
      : `${included.length} accounts`
  const matching = accounts.filter((account) =>
    `${account.name} ${account.detail}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const draftCount = selectable.filter((account) => draft.has(account.id)).length

  const rows = (selection: Set<string>, toggle: (id: string, checked: boolean) => void): JSX.Element => (
    <Stack spacing={presentation === 'sidebar' ? 2 : 0} px={presentation === 'sidebar' ? 0 : 2} pb={2}>
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
            _hover={{ bg: 'neutral.100' }}
            aria-label={`Reconnect ${account.name}`}
          >
            <Text textStyle="text/sm" fontWeight="medium">
              {account.name}
            </Text>
            <Text textStyle="text/xs" color="warning.700">
              Reconnect needed
            </Text>
          </Flex>
        ) : (
          <Checkbox
            as="label"
            key={account.id}
            aria-label={`Include ${account.name}`}
            isChecked={selection.has(account.id)}
            onChange={(event) => {
              toggle(account.id, event.target.checked)
            }}
            colorScheme="gray"
            sx={{
              '.chakra-checkbox__label': { display: 'contents', margin: 0 },
              '&:has(:focus-visible)': {
                outline: '2px solid',
                outlineColor: 'activeState.80',
                outlineOffset: '2px',
              },
              '.chakra-checkbox__control': { gridColumn: 1, gridRow: 1, alignSelf: 'center' },
            }}
            cursor="pointer"
            display={presentation === 'sidebar' ? 'grid' : 'flex'}
            gridTemplateColumns={presentation === 'sidebar' ? '16px minmax(0, 1fr)' : undefined}
            columnGap={3}
            rowGap={1}
            alignItems={presentation === 'sidebar' ? 'start' : 'center'}
            gap={presentation === 'sidebar' ? undefined : 3}
            p={3}
            position="relative"
            borderRadius="control"
            bg={selection.has(account.id) ? 'neutral.50' : 'transparent'}
            _hover={{ bg: 'neutral.100' }}
          >
            <Box flex="1" minW={0} display={presentation === 'sidebar' ? 'contents' : undefined}>
              <Flex
                display={presentation === 'sidebar' ? 'contents' : 'flex'}
                direction={presentation === 'sidebar' ? 'column' : 'row'}
                align={presentation === 'sidebar' ? 'stretch' : 'center'}
                justify="space-between"
                gap={presentation === 'sidebar' ? 2 : 3}
                flexWrap={presentation === 'sidebar' ? 'nowrap' : 'wrap'}
              >
                <Box minW={0} display={presentation === 'sidebar' ? 'contents' : undefined}>
                  <Flex align="center" gap={2} gridColumn={2} minW={0}>
                    <Text
                      color="neutral.900"
                      textStyle="text/sm"
                      fontWeight="medium"
                      textAlign="left"
                      overflowWrap="anywhere"
                      minW={0}
                      display="flex"
                      alignItems="center"
                    >
                      {account.name}
                    </Text>
                    <HistorySyncStatus
                      syncing={historySyncingAccountIds.includes(account.id)}
                      synced={recentlySyncedAccountIds.includes(account.id)}
                      compact
                    />
                  </Flex>
                  {presentation === 'sidebar' && compact ? (
                    <Text
                      gridColumn={2}
                      textStyle="text/xs"
                      color="neutral.600"
                      mt={1}
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      <>
                        <BitcoinAmount btc={account.sats / 100_000_000} />
                      </>
                    </Text>
                  ) : (
                    <Flex gridColumn={2} align="baseline" gap={1.5} flexWrap="wrap" color="neutral.600">
                      <Text textStyle="text/xs">{account.detail}</Text>
                    </Flex>
                  )}
                </Box>
                {!(presentation === 'sidebar' && compact) && (
                  <Flex
                    gridColumn={2}
                    mt={presentation === 'sidebar' ? 1 : undefined}
                    pr={presentation === 'sidebar' ? 7 : undefined}
                    direction="column"
                    align={presentation === 'sidebar' ? 'flex-start' : 'flex-end'}
                    gap={1}
                    minW={0}
                    flexShrink={0}
                  >
                    <Text
                      textStyle={presentation === 'sidebar' ? 'text/sm' : 'text/xs'}
                      overflowWrap="anywhere"
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      <>
                        <BitcoinAmount btc={account.sats / 100_000_000} />
                      </>
                    </Text>
                    <Text textStyle="text/xs" color="neutral.600" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      <>
                        <UsdEquivalent btc={account.sats / 100_000_000} btcPrice={btcPrice} />
                      </>
                    </Text>
                    {presentation !== 'sidebar' && (
                      <>
                        <AccountShare sats={account.sats} totalSats={totalSats} />
                      </>
                    )}
                  </Flex>
                )}
              </Flex>
            </Box>
            {presentation === 'sidebar' && !compact && (
              <Box position="absolute" bottom={3} right={3}>
                <>
                  <AccountShare sats={account.sats} totalSats={totalSats} iconOnly />
                </>
              </Box>
            )}
          </Checkbox>
        ),
      )}
      {matching.length === 0 && (
        <Text textStyle="text/sm" color="neutral.600" p={4}>
          No accounts match your search.
        </Text>
      )}
    </Stack>
  )

  if (presentation === 'sidebar') {
    const selection = new Set(included.map((account) => account.id))
    return (
      <MotionBox
        as="aside"
        layout="position"
        transition={{ duration: reduceMotion === true ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
        aria-label="Portfolio accounts"
        w={collapsed ? '44px' : '280px'}
        minW={collapsed ? '44px' : '280px'}
        h="full"
        position="relative"
        flexShrink={0}
        pr={collapsed ? 0 : 3}
      >
        <MotionBox
          aria-hidden="true"
          position="absolute"
          top={0}
          bottom={0}
          left="43px"
          w="1px"
          bgGradient="linear(to-b, transparent, neutral.200 8%, neutral.200 92%, transparent)"
          pointerEvents="none"
          initial={false}
          animate={{ transform: collapsed ? 'translateX(0px)' : 'translateX(236px)' }}
          transition={{ duration: reduceMotion === true ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
        />
        {collapsed ? (
          <Tooltip label="Expand accounts" placement="right">
            <IconButton
              aria-label="Expand accounts"
              aria-expanded={false}
              icon={<ChevronRight size={16} strokeWidth={1.5} />}
              color="neutral.600"
              variant="ghost"
              onClick={() => {
                setCollapsed(false)
              }}
            />
          </Tooltip>
        ) : (
          <Box as={motion.div} layout="position" w="268px">
            <Flex align="center" justify="space-between" gap={2} mb={3}>
              <Text textStyle="text/md" fontWeight="medium">
                Accounts
              </Text>
              <Flex align="center" gap={2}>
                <Text textStyle="text/xs" color="neutral.600" aria-live="polite">
                  {included.length} of {selectable.length}
                </Text>
                <Tooltip label="Collapse accounts" placement="top">
                  <IconButton
                    aria-label="Collapse accounts"
                    aria-expanded={true}
                    icon={<ChevronLeft size={16} strokeWidth={1.5} />}
                    color="neutral.600"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCollapsed(true)
                    }}
                  />
                </Tooltip>
              </Flex>
            </Flex>
            <Flex
              as="fieldset"
              aria-label="Account detail level"
              gap={1}
              p={1}
              mb={3}
              bg="neutral.50"
              borderRadius="control"
            >
              {([true, false] as const).map((isCompact) => (
                <Button
                  key={String(isCompact)}
                  flex="1"
                  size="sm"
                  px={3}
                  minH="40px"
                  variant="ghost"
                  borderRadius="control"
                  border="none"
                  aria-label={isCompact ? 'Compact view' : 'Detailed view'}
                  aria-pressed={compact === isCompact}
                  bg={compact === isCompact ? 'neutral.200' : 'transparent'}
                  color={compact === isCompact ? 'neutral.900' : 'neutral.600'}
                  textStyle="text/xs"
                  fontWeight="medium"
                  _hover={{
                    bg: compact === isCompact ? 'neutral.200' : 'neutral.100',
                  }}
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
            <Input
              size="sm"
              h="40px"
              aria-label="Search accounts"
              placeholder="Search accounts"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
              mb={3}
            />
            <Button
              w="full"
              justifyContent="flex-start"
              size="sm"
              minH="40px"
              variant="outline"
              aria-pressed={isAll}
              bg={isAll ? 'neutral.100' : 'transparent'}
              mb={3}
              onClick={() => {
                onSelectionChange(new Set())
              }}
            >
              All accounts
            </Button>
            {rows(selection, (id, checked) => {
              const next = new Set(selection)
              if (checked) {
                next.add(id)
              } else {
                next.delete(id)
              }
              // Empty sets mean all accounts in the API. Keep the last selected account checked.
              if (next.size > 0) {
                onSelectionChange(next.size === selectable.length ? new Set() : next)
              }
            })}
            <Button
              as={Link}
              to="/accounts"
              variant="ghost"
              size="sm"
              justifyContent="flex-start"
              minH="40px"
              w="full"
              mt={2}
            >
              Manage accounts
            </Button>
          </Box>
        )}
      </MotionBox>
    )
  }

  return (
    <Flex align="center" gap={3} flexWrap="wrap">
      <Popover
        isOpen={isOpen}
        onOpen={() => {
          setDraft(new Set(included.map((account) => account.id)))
          setSearch('')
          onOpen()
        }}
        onClose={onClose}
        initialFocusRef={searchRef}
        placement="bottom-start"
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
            <Text as="span" ml={2} color="neutral.600" fontWeight="normal">
              {isAll ? selectable.length : `${included.length} of ${selectable.length}`}
            </Text>
          </Button>
        </PopoverTrigger>
        <Portal>
          <PopoverContent
            w="400px"
            maxW="calc(100vw - 32px)"
            maxH="calc(100dvh - 32px)"
            borderRadius="panel"
            overflow="hidden"
          >
            <PopoverHeader p={4} borderColor="neutral.200" flexShrink={0}>
              <Text textStyle="text/md" fontWeight="medium">
                Accounts in this view
              </Text>
              <Text textStyle="text/sm" color="neutral.600" mt={1}>
                Choose which holdings to include.
              </Text>
              <Input
                ref={searchRef}
                aria-label="Search accounts"
                placeholder="Search accounts"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
                mt={3}
              />
            </PopoverHeader>
            <PopoverBody p={0} overflowY="auto" minH={0}>
              <Flex px={4} py={2} align="center" justify="space-between" gap={2}>
                <Text textStyle="text/xs" color="neutral.600" aria-live="polite">
                  {draftCount} of {selectable.length} selected
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(new Set(selectable.map((account) => account.id)))
                  }}
                >
                  Select all
                </Button>
              </Flex>
              <Box maxH="320px" overflowY="auto">
                {rows(draft, (id, checked) => {
                  setDraft((previous) => {
                    const next = new Set(previous)
                    if (checked) {
                      next.add(id)
                    } else {
                      next.delete(id)
                    }
                    return next
                  })
                })}
              </Box>
            </PopoverBody>
            <PopoverFooter p={4} borderColor="neutral.200" flexShrink={0}>
              {draftCount === 0 && (
                <Text textStyle="text/xs" color="neutral.600" mb={3}>
                  Select at least one account.
                </Text>
              )}
              <Flex justify="space-between" gap={2} align="center" flexWrap="wrap">
                <Button as={Link} to="/accounts" variant="ghost" size="sm">
                  Manage accounts
                </Button>
                <Flex gap={2}>
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    isDisabled={draftCount === 0}
                    onClick={() => {
                      onSelectionChange(
                        draftCount === selectable.length
                          ? new Set()
                          : new Set(selectable.filter((account) => draft.has(account.id)).map((account) => account.id)),
                      )
                      onClose()
                    }}
                  >
                    Apply
                  </Button>
                </Flex>
              </Flex>
            </PopoverFooter>
          </PopoverContent>
        </Portal>
      </Popover>
      {!isAll && (
        <>
          {included.length > 1 && (
            <Text textStyle="text/sm" color="neutral.600" flex="1" minW={0} noOfLines={2}>
              {included.map((account) => account.name).join(', ')}
            </Text>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onSelectionChange(new Set())
            }}
          >
            Show all
          </Button>
        </>
      )}
    </Flex>
  )
}

function AccountShare({
  sats,
  totalSats,
  iconOnly = false,
}: {
  sats: number
  totalSats: number
  iconOnly?: boolean
}): JSX.Element {
  const percentage = totalSats > 0 ? Math.min(100, Math.max(0, (sats / totalSats) * 100)) : 0
  const label = percentage > 0 && percentage < 0.1 ? '<0.1' : percentage.toFixed(1)

  const chart = (
    <Box as="svg" viewBox="0 0 20 20" boxSize={4} flexShrink={0} aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.15" />
      <circle
        cx="10"
        cy="10"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        pathLength="100"
        strokeDasharray={`${percentage} ${100 - percentage}`}
        transform="rotate(-90 10 10)"
      />
    </Box>
  )

  if (iconOnly) {
    return (
      <Tooltip label={`${label}% of total`} hasArrow>
        <Box as="span" display="flex" color="neutral.600" aria-label={`${label}% of total`}>
          {chart}
        </Box>
      </Tooltip>
    )
  }

  return (
    <Flex align="center" gap={1.5} color="neutral.600">
      {chart}
      <Text textStyle="text/xs" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {label}% of total
      </Text>
    </Flex>
  )
}
