import {
  Box,
  Button,
  Checkbox,
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
  useDisclosure,
} from '@chakra-ui/react'
import type { BalanceValue } from '@hoseki/packages/lib/balance'
import type { ClaimId } from '@hoseki/packages/schemas'
import { ChevronDown } from 'lucide-react'
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

interface AccountFilterProps {
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
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const accounts = [
    ...claims.map((claim) => ({
      id: claim.id,
      name: claim.displayName ?? claim.officialName,
      detail: ensureClaimStatusNotExpired(claim) === 'pending' ? 'Self-custody · Pending' : 'Self-custody',
      sats: Number(balances?.get(claim.id)?.current ?? 0),
    })),
    ...exchangeAccounts.map((account) => ({
      id: account.id,
      name: account.displayName,
      detail: needsExchangeReconnect(account) ? `${account.exchange} · Reconnect needed` : account.exchange,
      sats: Number(account.balance ?? 0),
    })),
    ...manualAccounts.map((account) => ({
      id: account.id,
      name: account.displayName,
      detail: 'Manual account',
      sats: Number(account.balance ?? 0),
    })),
    ...etfAccounts.map((account) => ({
      id: account.id,
      name: account.displayName,
      detail: 'ETF',
      sats: Number(account.balance ?? 0),
    })),
  ]
  const totalSats = accounts.reduce((total, account) => total + account.sats, 0)
  const included = accounts.filter((account) => selected.size === 0 || selected.has(account.id))
  const isAll = included.length === accounts.length
  const label = isAll
    ? 'All accounts'
    : included.length === 1
      ? included[0]?.name ?? 'Account'
      : `${included.length} accounts`
  const matching = accounts.filter((account) =>
    `${account.name} ${account.detail}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const draftCount = accounts.filter((account) => draft.has(account.id)).length

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
              {isAll ? accounts.length : `${included.length} of ${accounts.length}`}
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
                onChange={(event) => setSearch(event.target.value)}
                mt={3}
              />
            </PopoverHeader>
            <PopoverBody p={0} overflowY="auto" minH={0}>
              <Flex px={4} py={2} align="center" justify="space-between" gap={2}>
                <Text textStyle="text/xs" color="neutral.600" aria-live="polite">
                  {draftCount} of {accounts.length} selected
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft(new Set(accounts.map((account) => account.id)))}
                >
                  Select all
                </Button>
              </Flex>
              <Stack spacing={0} px={2} pb={2} maxH="320px" overflowY="auto">
                {matching.map((account) => (
                  <Checkbox
                    key={account.id}
                    isChecked={draft.has(account.id)}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setDraft((previous) => {
                        const next = new Set(previous)
                        if (checked) next.add(account.id)
                        else next.delete(account.id)
                        return next
                      })
                    }}
                    colorScheme="gray"
                    alignItems="center"
                    p={3}
                    minH="64px"
                    borderRadius="control"
                    bg={draft.has(account.id) ? 'neutral.50' : 'transparent'}
                    _hover={{ bg: 'neutral.100' }}
                    sx={{ '.chakra-checkbox__label': { width: '100%', minWidth: 0 } }}
                  >
                    <Flex align="center" justify="space-between" gap={3}>
                      <Box minW={0}>
                        <Flex align="center" gap={2}>
                          <Text textStyle="text/sm" fontWeight="medium" overflowWrap="anywhere">
                            {account.name}
                          </Text>
                          <HistorySyncStatus
                            syncing={historySyncingAccountIds.includes(account.id)}
                            synced={recentlySyncedAccountIds.includes(account.id)}
                            compact
                          />
                        </Flex>
                        <Text textStyle="text/xs" color="neutral.600" textTransform="capitalize">
                          {account.detail}
                        </Text>
                      </Box>
                      <Flex direction="column" align="flex-end" gap={1} flexShrink={0}>
                        <Text textStyle="text/xs" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          <SensitiveValue>
                            <BitcoinAmount btc={account.sats / 100_000_000} />
                          </SensitiveValue>
                        </Text>
                        <Text textStyle="text/xs" color="neutral.600" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          <SensitiveValue>
                            <UsdEquivalent btc={account.sats / 100_000_000} btcPrice={btcPrice} />
                          </SensitiveValue>
                        </Text>
                        <SensitiveValue>
                          <AccountShare sats={account.sats} totalSats={totalSats} />
                        </SensitiveValue>
                      </Flex>
                    </Flex>
                  </Checkbox>
                ))}
                {matching.length === 0 && (
                  <Text textStyle="text/sm" color="neutral.600" p={4}>
                    No accounts match your search.
                  </Text>
                )}
              </Stack>
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
                        draftCount === accounts.length
                          ? new Set()
                          : new Set(accounts.filter((account) => draft.has(account.id)).map((account) => account.id)),
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
          <Button variant="ghost" size="sm" onClick={() => onSelectionChange(new Set())}>
            Show all
          </Button>
        </>
      )}
    </Flex>
  )
}

function AccountShare({ sats, totalSats }: { sats: number; totalSats: number }): JSX.Element {
  const percentage = totalSats > 0 ? Math.min(100, Math.max(0, (sats / totalSats) * 100)) : 0
  const label = percentage > 0 && percentage < 0.1 ? '<0.1' : percentage.toFixed(1)

  return (
    <Flex align="center" gap={1.5} color="neutral.600">
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
      <Text textStyle="text/xs" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {label}% of total
      </Text>
    </Flex>
  )
}
