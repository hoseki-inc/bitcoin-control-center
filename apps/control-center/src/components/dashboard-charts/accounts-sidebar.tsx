import { Box, Button, Divider, Flex, Icon, Stack, Text, Tooltip } from '@chakra-ui/react'
import type { BalanceValue } from '@hoseki/packages/lib/balance'
import type { ClaimId } from '@hoseki/packages/schemas'
import { CheckCircleFilledIcon, KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui'
import type { ClaimCardKeystore } from '@hoseki/packages/ui/prove-verify-ui/claims/claim-card'
import { type SupportedHardwareWallet, getSupportedHardwareWalletLogoPath } from '@hoseki/packages/wallet'
import { useNavigate } from 'react-router'
import type { RouterOutput } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import { ensureClaimStatusNotExpired, mapClaimToClaimCardProps } from '../../utils/claim-utils'
import { needsExchangeReconnect } from '../../utils/exchange-connection-status'
import { BitcoinAmount } from '../bitcoin-amount'
import { SensitiveValue } from '../sensitive-value'
import { HistorySyncStatus } from './history-sync-status'

type ExchangeAccountDto = RouterOutput['portalProve']['exchange']['list'][number]
type ManualAccountDto = RouterOutput['portalProve']['manual']['list'][number]
type EtfAccountDto = RouterOutput['portalProve']['etf']['list'][number]

interface ExchangeConfig {
  label: string
  logo: string
  detailsPath: string
}

const defaultExchangeConfig: ExchangeConfig = {
  label: 'Coinbase',
  logo: '/images/exchanges/coinbase.svg',
  detailsPath: '/accounts/coinbase',
}

const exchangeConfig: Record<string, ExchangeConfig> = {
  coinbase: defaultExchangeConfig,
  kraken: { label: 'Kraken', logo: '/images/exchanges/kraken.svg', detailsPath: '/accounts/kraken' },
  robinhood: { label: 'Robinhood', logo: '/images/exchanges/robinhood-icon.svg', detailsPath: '/accounts/robinhood' },
  strike: { label: 'Strike', logo: '/images/exchanges/strike-icon.svg', detailsPath: '/accounts/strike' },
}

interface AccountsSidebarProps {
  claims: ClaimDto[]
  exchangeAccounts?: ExchangeAccountDto[]
  manualAccounts?: ManualAccountDto[]
  etfAccounts?: EtfAccountDto[]
  balances: Map<ClaimId, BalanceValue | null>
  selected: Set<string>
  onToggle: (id: string) => void
  onClearAll: () => void
  totalBtcSats: number
  btcPrice?: number | null
  totalUsd: number
  compact?: boolean
  historySyncingAccountIds?: string[]
  recentlySyncedAccountIds?: string[]
  /** When provided, renders a toggle button to switch between compact/detailed view */
  onToggleCompact?: () => void
}

export function AccountsSidebar({
  claims,
  exchangeAccounts = [],
  manualAccounts = [],
  etfAccounts = [],
  balances,
  selected,
  onToggle,
  onClearAll,
  totalBtcSats,
  totalUsd,
  btcPrice,
  compact = false,
  historySyncingAccountIds = [],
  recentlySyncedAccountIds = [],
  onToggleCompact,
}: AccountsSidebarProps): JSX.Element {
  const navigate = useNavigate()
  const isShowingAll = selected.size === 0
  const totalBtc = totalBtcSats / 100_000_000

  // Build unified sorted list — highest BTC balance first
  type ClaimItem = { type: 'claim'; claim: ClaimDto; btcSats: number }
  type ExchangeItem = { type: 'exchange'; account: ExchangeAccountDto; btcSats: number }
  type ManualItem = { type: 'manual'; account: ManualAccountDto; btcSats: number }
  type AccountItem = ClaimItem | ExchangeItem | ManualItem

  const allItems: AccountItem[] = [
    ...claims.map(
      (claim): ClaimItem => ({
        type: 'claim',
        claim,
        btcSats: balances ? Number(balances.get(claim.id)?.current ?? 0) : 0,
      }),
    ),
    ...exchangeAccounts.map(
      (account): ExchangeItem => ({
        type: 'exchange',
        account,
        btcSats: account.balance ? Number(account.balance) : 0,
      }),
    ),
    ...manualAccounts.map(
      (account): ManualItem => ({
        type: 'manual',
        account,
        btcSats: account.balance ? Number(account.balance) : 0,
      }),
    ),
    ...etfAccounts.map(
      (account): ManualItem => ({
        type: 'manual',
        account: account as unknown as ManualAccountDto,
        btcSats: account.balance ? Number(account.balance) : 0,
      }),
    ),
  ].sort((a, b) => b.btcSats - a.btcSats)

  return (
    <Box
      w={{ base: '100%', lg: compact ? '240px' : '304px' }}
      maxH={{ base: '240px', lg: 'none' }}
      flexShrink={0}
      borderBottomWidth={{ base: '1px', lg: '0' }}
      borderBottomColor="neutral.200"
      bg="shades.0"
      px={compact ? 3 : 5}
      py={{ base: 4, lg: 8 }}
      display="flex"
      flexDirection="column"
      h="100%"
      overflowY="auto"
    >
      {/* Header */}
      <Flex align="center" justify="space-between" mb={compact ? 2 : 3} px={compact ? 0.5 : 1}>
        <Text textStyle="text/sm" fontWeight="medium" color="neutral.600">
          Accounts
        </Text>
        <Text textStyle="text/xs" color="neutral.500" aria-live="polite">
          {isShowingAll ? `${allItems.length} total` : `${selected.size} selected`}
        </Text>
      </Flex>

      {onToggleCompact && (
        <Flex role="group" aria-label="Account view" bg="neutral.50" p={1} borderRadius="control" gap={1} mb={4}>
          {(
            [
              { label: 'Compact', compact: true },
              { label: 'Detailed', compact: false },
            ] as const
          ).map((view) => (
            <Button
              key={view.label}
              size="sm"
              variant="ghost"
              flex={1}
              minH="36px"
              aria-pressed={compact === view.compact}
              bg={compact === view.compact ? 'neutral.200' : 'transparent'}
              color={compact === view.compact ? 'neutral.900' : 'neutral.600'}
              onClick={() => {
                if (compact !== view.compact) onToggleCompact()
              }}
            >
              {view.label}
            </Button>
          ))}
        </Flex>
      )}

      {/* All Accounts pill */}
      <Box
        as="button"
        type="button"
        textAlign="left"
        aria-pressed={isShowingAll}
        _focusVisible={{ outline: '2px solid', outlineColor: 'neutral.900', outlineOffset: '2px' }}
        onClick={onClearAll}
        px={compact ? 2.5 : 4}
        py={compact ? 2.5 : 3.5}
        borderRadius="control"
        border="1px solid"
        borderColor={isShowingAll ? 'neutral.400' : 'transparent'}
        bg={isShowingAll ? 'neutral.50' : 'shades.0'}
        cursor="pointer"
        mb={compact ? 1.5 : 2}
        transition="background-color 0.15s ease"
        _hover={{ bg: 'neutral.100' }}
      >
        {compact ? (
          <>
            <Text textStyle="text/xs" fontWeight="medium" color="neutral.900" mb={0.5}>
              All Accounts
            </Text>
            <Text
              fontFamily="body"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
              textStyle="text/xs"
              fontWeight="medium"
              color="neutral.600"
            >
              <SensitiveValue>
                <BitcoinAmount btc={totalBtc} />
              </SensitiveValue>
            </Text>
          </>
        ) : (
          <>
            <Flex align="center" justify="space-between" gap={2} flexWrap="wrap">
              <Text textStyle="text/md" fontWeight="medium" color="neutral.900">
                All Accounts
              </Text>
              <Text
                fontFamily="body"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
                textStyle="text/sm"
                fontWeight="medium"
                color="neutral.600"
              >
                <SensitiveValue>
                  <BitcoinAmount btc={totalBtc} />
                </SensitiveValue>
              </Text>
            </Flex>
            <Text
              textStyle="text/xs"
              color="neutral.600"
              mt={1}
              fontFamily="body"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <SensitiveValue>
                ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </SensitiveValue>
            </Text>
          </>
        )}
      </Box>

      <Divider borderColor="neutral.200" my={compact ? 2 : 3} />

      {/* Account list — sorted by BTC balance descending */}
      <Stack gap={2}>
        {allItems.map((item) => {
          const btcAmount = item.btcSats / 100_000_000
          const pct = totalBtcSats > 0 ? ((item.btcSats / totalBtcSats) * 100).toFixed(1) : '0.0'

          if (item.type === 'exchange') {
            const isSelected = selected.has(item.account.id)
            const needsReconnect = needsExchangeReconnect(item.account)
            const config = exchangeConfig[item.account.exchange] ?? defaultExchangeConfig
            return (
              <ExchangeAccountPill
                key={item.account.id}
                name={item.account.displayName}
                exchange={item.account.exchange}
                btcAmount={btcAmount}
                btcPrice={btcPrice}
                pct={pct}
                isSelected={isSelected}
                needsReconnect={needsReconnect}
                compact={compact}
                onClick={() => {
                  if (needsReconnect) {
                    navigate(`${config.detailsPath}/${item.account.id}`)
                    return
                  }
                  onToggle(item.account.id)
                }}
              />
            )
          }

          if (item.type === 'manual') {
            const isSelected = selected.has(item.account.id)
            return (
              <ManualAccountPill
                key={item.account.id}
                name={item.account.displayName}
                btcAmount={btcAmount}
                btcPrice={btcPrice}
                pct={pct}
                isSelected={isSelected}
                compact={compact}
                onClick={() => onToggle(item.account.id)}
              />
            )
          }

          const isSelected = selected.has(item.claim.id)
          const isMultisig = item.claim.keystores.length > 1
          const walletLabel = isMultisig ? 'Multisig' : item.claim.keystores[0]?.wallet ?? 'unknown'
          const walletType: SupportedHardwareWallet | null = isMultisig ? null : item.claim.keystores[0]?.wallet ?? null
          const cardProps = isMultisig ? mapClaimToClaimCardProps(item.claim) : null

          const claimStatus = ensureClaimStatusNotExpired(item.claim)

          return (
            <AccountPill
              key={item.claim.id}
              name={item.claim.displayName ?? item.claim.officialName}
              provider={walletLabel}
              walletType={walletType}
              keystores={cardProps?.keystores}
              isPending={claimStatus === 'pending'}
              btcAmount={btcAmount}
              btcPrice={btcPrice}
              pct={pct}
              isSelected={isSelected}
              isHistorySyncing={historySyncingAccountIds.includes(item.claim.id)}
              isHistorySynced={recentlySyncedAccountIds.includes(item.claim.id)}
              compact={compact}
              onClick={() => onToggle(item.claim.id)}
            />
          )
        })}
      </Stack>
    </Box>
  )
}

interface ExchangeAccountPillProps {
  name: string
  exchange: string
  btcAmount: number
  btcPrice?: number | null
  pct: string
  isSelected: boolean
  needsReconnect: boolean
  compact: boolean
  onClick: () => void
}

function ExchangeAccountPill({
  name,
  exchange,
  btcAmount,
  btcPrice,
  pct,
  isSelected,
  needsReconnect,
  compact,
  onClick,
}: ExchangeAccountPillProps): JSX.Element {
  const config = exchangeConfig[exchange] ?? defaultExchangeConfig
  return (
    <Box
      as="button"
      type="button"
      textAlign="left"
      w="100%"
      aria-pressed={isSelected}
      _focusVisible={{ outline: '2px solid', outlineColor: 'neutral.900', outlineOffset: '2px' }}
      onClick={onClick}
      px={compact ? 2.5 : 4}
      py={compact ? 2 : 3.5}
      mt={compact && needsReconnect ? 1 : 0}
      borderRadius="control"
      border="1px solid"
      borderColor={isSelected && !needsReconnect ? 'neutral.400' : compact ? 'transparent' : 'neutral.200'}
      bg={needsReconnect || isSelected ? 'neutral.50' : 'shades.0'}
      cursor="pointer"
      transition="background-color 0.15s ease"
      position="relative"
      _hover={{ bg: 'neutral.100' }}
    >
      {/* Check indicator — full mode only */}
      {isSelected && !needsReconnect && <SelectedCheckmark compact={compact} />}
      {compact && needsReconnect && <StatusBadge label="Reconnect" tone="error" />}

      <Flex align="center" gap={compact ? 2 : 2.5} mb={compact ? 1 : 2} pr={isSelected ? 3 : 0}>
        <Box
          w={compact ? '20px' : '32px'}
          h={compact ? '20px' : '32px'}
          borderRadius={compact ? '4px' : '8px'}
          overflow="hidden"
          flexShrink={0}
        >
          <img
            src={config.logo}
            alt={config.label}
            style={{
              width: compact ? '20px' : '32px',
              height: compact ? '20px' : '32px',
              opacity: needsReconnect ? 0.55 : 1,
              filter: needsReconnect ? 'grayscale(1)' : 'none',
            }}
          />
        </Box>
        <Tooltip label={compact ? name : undefined} openDelay={300} hasArrow isDisabled={!compact}>
          <Text
            textStyle="text/sm"
            fontWeight="medium"
            color={needsReconnect ? 'neutral.500' : 'neutral.900'}
            isTruncated
            flex={1}
          >
            {name}
          </Text>
        </Tooltip>
      </Flex>

      {compact ? (
        <Flex align="center" justify="space-between" pl="28px">
          <Text
            fontFamily="body"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
            textStyle="text/xs"
            fontWeight="medium"
            color={needsReconnect ? 'neutral.400' : 'neutral.600'}
          >
            <SensitiveValue>{needsReconnect ? '—' : <BitcoinAmount btc={btcAmount} />}</SensitiveValue>
          </Text>
          {!needsReconnect && <MiniPieChart pct={parseFloat(pct)} />}
        </Flex>
      ) : (
        <>
          <Flex direction="column" align="flex-start" gap={2}>
            <Flex align="center" gap={1.5} flexWrap="wrap">
              <Text textStyle="text/xs" color="neutral.500">
                {config.label}
              </Text>
              {needsReconnect && (
                <Text textStyle="text/xs" color="error.500" fontWeight="medium">
                  · Reconnect
                </Text>
              )}
            </Flex>
            <Text
              fontFamily="body"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
              textStyle="text/sm"
              fontWeight="medium"
              color={needsReconnect ? 'neutral.400' : 'neutral.600'}
            >
              <SensitiveValue>{needsReconnect ? '—' : <BitcoinAmount btc={btcAmount} />}</SensitiveValue>
            </Text>
          </Flex>
          {!needsReconnect && (
            <>
              <AccountFiat btcAmount={btcAmount} btcPrice={btcPrice} />
              <ProportionBar pct={pct} />
            </>
          )}
        </>
      )}
    </Box>
  )
}

interface ManualAccountPillProps {
  name: string
  btcAmount: number
  btcPrice?: number | null
  pct: string
  isSelected: boolean
  compact: boolean
  onClick: () => void
}

function ManualAccountPill({
  name,
  btcAmount,
  btcPrice,
  pct,
  isSelected,
  compact,
  onClick,
}: ManualAccountPillProps): JSX.Element {
  return (
    <Box
      as="button"
      type="button"
      textAlign="left"
      w="100%"
      aria-pressed={isSelected}
      aria-label={`${name}, manually added`}
      _focusVisible={{ outline: '2px solid', outlineColor: 'neutral.900', outlineOffset: '2px' }}
      onClick={onClick}
      px={compact ? 2.5 : 4}
      py={compact ? 2 : 3.5}
      borderRadius="control"
      border="1px solid"
      borderColor={isSelected ? 'neutral.400' : compact ? 'transparent' : 'neutral.200'}
      bg={isSelected ? 'neutral.50' : 'shades.0'}
      cursor="pointer"
      transition="background-color 0.15s ease"
      position="relative"
      _hover={{ bg: 'neutral.100' }}
    >
      {isSelected && <SelectedCheckmark compact={compact} />}

      <Flex align="center" gap={compact ? 2 : 2.5} mb={compact ? 1 : 2} pr={isSelected ? 3 : 0}>
        <Flex
          w={compact ? '20px' : '32px'}
          h={compact ? '20px' : '32px'}
          borderRadius={compact ? '4px' : '8px'}
          bg="neutral.100"
          align="center"
          justify="center"
          flexShrink={0}
        >
          <ManualNoteIcon boxSize={compact ? '12px' : '18px'} />
        </Flex>
        <Tooltip label={compact ? `${name} · Manually tracked` : name} openDelay={300} hasArrow>
          <Text textStyle="text/sm" fontWeight="medium" color="neutral.900" isTruncated flex={1}>
            {name}
          </Text>
        </Tooltip>
      </Flex>

      {compact ? (
        <Flex align="center" justify="space-between" pl="28px">
          <Text
            fontFamily="body"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
            textStyle="text/xs"
            fontWeight="medium"
            color="neutral.600"
          >
            <SensitiveValue>
              <BitcoinAmount btc={btcAmount} />
            </SensitiveValue>
          </Text>
          <MiniPieChart pct={parseFloat(pct)} />
        </Flex>
      ) : (
        <>
          <Flex direction="column" align="flex-start" gap={2}>
            <Text textStyle="text/xs" color="neutral.600" fontWeight="medium">
              Manually tracked
            </Text>
            <Text
              fontFamily="body"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
              textStyle="text/sm"
              fontWeight="medium"
              color="neutral.600"
            >
              <SensitiveValue>
                <BitcoinAmount btc={btcAmount} />
              </SensitiveValue>
            </Text>
          </Flex>
          <AccountFiat btcAmount={btcAmount} btcPrice={btcPrice} />
          <ProportionBar pct={pct} />
        </>
      )}
    </Box>
  )
}

function ManualNoteIcon(props: { boxSize?: string }): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" color="neutral.600" {...props}>
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

interface AccountPillProps {
  name: string
  provider: string
  walletType: SupportedHardwareWallet | null
  keystores?: ClaimCardKeystore[]
  isPending?: boolean
  btcAmount: number
  btcPrice?: number | null
  pct: string
  isSelected: boolean
  isHistorySyncing: boolean
  isHistorySynced: boolean
  compact: boolean
  onClick: () => void
}

function AccountPill({
  name,
  provider,
  walletType,
  keystores,
  isPending,
  btcAmount,
  btcPrice,
  pct,
  isSelected,
  isHistorySyncing,
  isHistorySynced,
  compact,
  onClick,
}: AccountPillProps): JSX.Element {
  const isMultisig = keystores && keystores.length > 1
  const avatarSize = compact ? '20px' : '32px'

  return (
    <Box
      as="button"
      type="button"
      textAlign="left"
      w="100%"
      aria-pressed={isSelected}
      _focusVisible={{ outline: '2px solid', outlineColor: 'neutral.900', outlineOffset: '2px' }}
      onClick={onClick}
      px={compact ? 2.5 : 4}
      py={compact ? 2 : 3.5}
      mt={compact && isPending ? 1 : 0}
      borderRadius="control"
      border="1px solid"
      borderColor={isSelected ? 'neutral.400' : compact ? 'transparent' : 'neutral.200'}
      bg={isSelected ? 'neutral.50' : 'shades.0'}
      cursor="pointer"
      transition="background-color 0.15s ease"
      position="relative"
      _hover={{ bg: 'neutral.100' }}
    >
      {/* Check indicator — full mode only */}
      {isSelected && <SelectedCheckmark compact={compact} />}
      {compact && isPending && <StatusBadge label="Pending" />}

      {/* Logo + Name */}
      <Flex align="center" gap={compact ? 2 : 2.5} mb={compact ? 1 : 2} pr={isSelected ? 3 : 0}>
        {isMultisig && keystores ? (
          <Box flexShrink={0} w={avatarSize} h={avatarSize} position="relative">
            {keystores[0] && <MultisigMiniAvatar ks={keystores[0]} top="0" left="50%" transform="translateX(-50%)" />}
            {keystores[1] && <MultisigMiniAvatar ks={keystores[1]} bottom="0" left="0" />}
            {keystores[2] && <MultisigMiniAvatar ks={keystores[2]} bottom="0" right="0" />}
          </Box>
        ) : (
          <KeystoreAvatar
            variant="contained"
            size={avatarSize}
            alt={`${provider} wallet`}
            src={getSupportedHardwareWalletLogoPath(walletType)}
            flexShrink={0}
          />
        )}
        <Tooltip label={name} openDelay={300} hasArrow>
          <Text textStyle="text/sm" fontWeight="medium" color="neutral.900" isTruncated flex={1}>
            {name}
          </Text>
        </Tooltip>
        <HistorySyncStatus syncing={Boolean(isHistorySyncing)} synced={Boolean(isHistorySynced)} compact={compact} />
      </Flex>

      {compact ? (
        <Flex align="center" justify="space-between" pl="28px">
          <Text
            fontFamily="body"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
            textStyle="text/xs"
            fontWeight="medium"
            color="neutral.600"
          >
            <SensitiveValue>
              <BitcoinAmount btc={btcAmount} />
            </SensitiveValue>
          </Text>
          <MiniPieChart pct={parseFloat(pct)} />
        </Flex>
      ) : (
        <>
          <Flex direction="column" align="flex-start" gap={2}>
            <Flex align="center" gap={1.5} flexWrap="wrap">
              <Text textStyle="text/xs" color="neutral.500" textTransform="capitalize">
                {provider}
              </Text>
              {isPending && (
                <Text textStyle="text/xs" color="warning.700" fontWeight="medium">
                  · Pending
                </Text>
              )}
              {isHistorySyncing && (
                <Text textStyle="text/xs" color="neutral.600" fontWeight="medium">
                  · Updating history
                </Text>
              )}
            </Flex>
            <Text
              fontFamily="body"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
              textStyle="text/sm"
              fontWeight="medium"
              color="neutral.600"
            >
              <SensitiveValue>
                <BitcoinAmount btc={btcAmount} />
              </SensitiveValue>
            </Text>
          </Flex>
          <AccountFiat btcAmount={btcAmount} btcPrice={btcPrice} />
          <ProportionBar pct={pct} />
        </>
      )}
    </Box>
  )
}

function SelectedCheckmark({ compact }: { compact: boolean }): JSX.Element {
  const size = compact ? '14px' : '18px'
  const iconSize = compact ? '8px' : '10px'
  return (
    <Flex
      position="absolute"
      top="6px"
      right="6px"
      w={size}
      h={size}
      borderRadius="full"
      bg="neutral.900"
      align="center"
      justify="center"
    >
      <Icon viewBox="0 0 10 10" w={iconSize} h={iconSize} color="shades.0">
        <path
          d="M2 5.2L4 7.2L8 3.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Icon>
    </Flex>
  )
}

function StatusBadge({ label, tone = 'warning' }: { label: string; tone?: 'warning' | 'error' }): JSX.Element {
  const colors =
    tone === 'error'
      ? { bg: 'error.50', border: 'error.300', text: 'error.600' }
      : { bg: 'warning.50', border: 'warning.300', text: 'warning.600' }

  return (
    <Flex
      w="fit-content"
      mb={2}
      px={2}
      py={0.5}
      bg={colors.bg}
      border="1px solid"
      borderColor={colors.border}
      borderRadius="full"
      whiteSpace="nowrap"
    >
      <Text textStyle="text/xs" color={colors.text} fontWeight="medium">
        {label}
      </Text>
    </Flex>
  )
}

function MiniPieChart({ pct }: { pct: number }): JSX.Element {
  const size = 18
  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (Math.max(pct, 0.5) / 100) * circumference
  const displayPct = pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`

  return (
    <Tooltip label={`${displayPct} of total stack`} openDelay={200} hasArrow>
      <Box
        as="svg"
        color="neutral.600"
        w={`${size}px`}
        h={`${size}px`}
        flexShrink={0}
        transform="rotate(-90deg)"
        cursor="default"
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
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
        />
      </Box>
    </Tooltip>
  )
}

function AccountFiat({ btcAmount, btcPrice }: { btcAmount: number; btcPrice?: number | null }): JSX.Element {
  return (
    <Text textStyle="text/xs" color="neutral.500" mt={1} sx={{ fontVariantNumeric: 'tabular-nums' }}>
      <SensitiveValue>
        {btcPrice == null
          ? 'USD unavailable'
          : (btcAmount * btcPrice).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
      </SensitiveValue>
    </Text>
  )
}

function ProportionBar({ pct }: { pct: string }): JSX.Element {
  return (
    <Box mt={3}>
      <Flex justify="space-between" gap={2} mb={1.5}>
        <Text textStyle="text/xs" color="neutral.500">
          Share of portfolio
        </Text>
        <Text textStyle="text/xs" fontWeight="medium" color="neutral.700" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {pct}%
        </Text>
      </Flex>
      <Box h="3px" bg="neutral.100" borderRadius="full" overflow="hidden">
        <Box h="100%" w={`${Math.min(100, Math.max(0, parseFloat(pct)))}%`} bg="neutral.600" borderRadius="full" />
      </Box>
    </Box>
  )
}

interface MultisigMiniAvatarProps {
  ks: ClaimCardKeystore
  top?: string
  bottom?: string
  left?: string
  right?: string
  transform?: string
}

function MultisigMiniAvatar({ ks, ...positionProps }: MultisigMiniAvatarProps): JSX.Element {
  return (
    <Box position="absolute" {...positionProps}>
      <KeystoreAvatar
        size="18px"
        src={ks.wallet ? getSupportedHardwareWalletLogoPath(ks.wallet) : undefined}
        alt={`${ks.wallet ?? 'key'} wallet`}
      >
        {ks.isVerified && (
          <KeystoreAvatar.Badge boxSize="10px" bottom="0" right="-1px">
            <CheckCircleFilledIcon color="neutral.600" color2="white" boxSize="10px" />
          </KeystoreAvatar.Badge>
        )}
      </KeystoreAvatar>
    </Box>
  )
}
