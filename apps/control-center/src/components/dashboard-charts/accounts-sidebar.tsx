import { Box, Divider, Flex, Icon, Spinner, Stack, Text, Tooltip } from '@chakra-ui/react'
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
  compact = false,
  historySyncingAccountIds = [],
  recentlySyncedAccountIds = [],
  onToggleCompact,
}: AccountsSidebarProps): JSX.Element {
  const navigate = useNavigate()
  const isShowingAll = selected.size === 0
  const totalBtc = totalBtcSats / 100_000_000

  const selectedBtcSats = isShowingAll
    ? totalBtcSats
    : claims
        .filter((c) => selected.has(c.id))
        .reduce((sum, c) => {
          const b = balances.get(c.id)
          return sum + (b ? Number(b.current) : 0)
        }, 0) +
      exchangeAccounts
        .filter((a) => selected.has(a.id))
        .reduce((sum, a) => sum + (a.balance ? Number(a.balance) : 0), 0) +
      manualAccounts
        .filter((a) => selected.has(a.id))
        .reduce((sum, a) => sum + (a.balance ? Number(a.balance) : 0), 0) +
      etfAccounts.filter((a) => selected.has(a.id)).reduce((sum, a) => sum + (a.balance ? Number(a.balance) : 0), 0)

  // Build unified sorted list — highest BTC balance first
  type ClaimItem = { type: 'claim'; claim: ClaimDto; btcSats: number }
  type ExchangeItem = { type: 'exchange'; account: ExchangeAccountDto; btcSats: number }
  type ManualItem = { type: 'manual'; account: ManualAccountDto; btcSats: number }
  type AccountItem = ClaimItem | ExchangeItem | ManualItem

  const allItems: AccountItem[] = [
    ...claims.map((claim): ClaimItem => ({
      type: 'claim',
      claim,
      btcSats: Number(balances.get(claim.id)?.current ?? 0),
    })),
    ...exchangeAccounts.map((account): ExchangeItem => ({
      type: 'exchange',
      account,
      btcSats: account.balance ? Number(account.balance) : 0,
    })),
    ...manualAccounts.map((account): ManualItem => ({
      type: 'manual',
      account,
      btcSats: account.balance ? Number(account.balance) : 0,
    })),
    ...etfAccounts.map((account): ManualItem => ({
      type: 'manual',
      account: account as unknown as ManualAccountDto,
      btcSats: account.balance ? Number(account.balance) : 0,
    })),
  ].sort((a, b) => b.btcSats - a.btcSats)

  return (
    <Box
      w={compact ? '200px' : '320px'}
      flexShrink={0}
      borderRight="1px solid"
      borderColor="neutral.200"
      bg="shades.0"
      px={compact ? 3 : 5}
      py={compact ? 6 : 8}
      display="flex"
      flexDirection="column"
      h="100%"
      overflowY="auto"
    >
      {/* Header */}
      <Flex align="center" justify="space-between" mb={compact ? 2 : 3} px={compact ? 0.5 : 1}>
        <Text textStyle={compact ? 'label/xs' : 'label/md'} fontWeight="semibold" color="neutral.400">
          Accounts
        </Text>
        <Flex align="center" gap={2}>
          {!isShowingAll && (
            <Text
              textStyle={compact ? 'label/xs' : 'label/sm'}
              color="neutral.500"
              cursor="pointer"
              fontWeight="medium"
              onClick={onClearAll}
              _hover={{ color: 'neutral.700' }}
            >
              {compact ? 'Clear' : 'Clear all'}
            </Text>
          )}
          {onToggleCompact && (
            <Tooltip label={compact ? 'Detailed view' : 'Compact view'} openDelay={300} hasArrow>
              <Flex
                as="button"
                onClick={onToggleCompact}
                align="center"
                justify="center"
                w="24px"
                h="24px"
                borderRadius="5px"
                border="1px solid"
                borderColor="neutral.200"
                color="neutral.400"
                bg="shades.0"
                _hover={{ bg: 'neutral.50', borderColor: 'neutral.300', color: 'neutral.600' }}
                transition="all 0.15s ease"
              >
                <Icon viewBox="0 0 16 16" boxSize="14px">
                  {compact ? (
                    <>
                      <rect
                        x="1"
                        y="1"
                        width="14"
                        height="5"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        fill="none"
                      />
                      <rect
                        x="1"
                        y="10"
                        width="14"
                        height="5"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        fill="none"
                      />
                    </>
                  ) : (
                    <>
                      <rect
                        x="1"
                        y="2"
                        width="14"
                        height="2.5"
                        rx="0.75"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        fill="none"
                      />
                      <rect
                        x="1"
                        y="6.75"
                        width="14"
                        height="2.5"
                        rx="0.75"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        fill="none"
                      />
                      <rect
                        x="1"
                        y="11.5"
                        width="14"
                        height="2.5"
                        rx="0.75"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        fill="none"
                      />
                    </>
                  )}
                </Icon>
              </Flex>
            </Tooltip>
          )}
        </Flex>
      </Flex>

      {/* All Accounts pill */}
      <Box
        onClick={onClearAll}
        px={compact ? 2.5 : 4}
        py={compact ? 2.5 : 3.5}
        borderRadius={compact ? '8px' : '12px'}
        border="1px solid"
        borderColor={isShowingAll ? 'neutral.900' : 'neutral.200'}
        bg={isShowingAll ? 'neutral.50' : 'shades.0'}
        cursor="pointer"
        mb={compact ? 1.5 : 2}
        transition="all 0.15s ease"
        _hover={!isShowingAll ? { shadow: 'sm', transform: 'translateY(-1px)' } : undefined}
      >
        {compact ? (
          <>
            <Text textStyle="label/xs" fontWeight="semibold" color="neutral.900" mb={0.5}>
              All Accounts
            </Text>
            <Text fontFamily="mono" textStyle="text/xs" fontWeight="semibold" color="neutral.600">
              {totalBtc.toFixed(8)}
            </Text>
          </>
        ) : (
          <>
            <Flex align="center" justify="space-between">
              <Text textStyle="text/md" fontWeight="semibold" color="neutral.900">
                All Accounts
              </Text>
              <Text fontFamily="mono" textStyle="text/sm" fontWeight="semibold" color="neutral.600">
                {totalBtc.toFixed(8)}
              </Text>
            </Flex>
            <Text textStyle="label/sm" color="success.600" mt={1} fontFamily="mono">
              ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </>
        )}
      </Box>

      <Divider borderColor="neutral.200" my={compact ? 2 : 3} />

      {/* Account list — sorted by BTC balance descending */}
      <Stack gap={compact ? 1.5 : 2}>
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
                pct={pct}
                isSelected={isSelected}
                needsReconnect={needsReconnect}
                compact={compact}
                onClick={() => {
                  if (needsReconnect) {
                    void navigate(`${config.detailsPath}/${item.account.id}`)
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
                pct={pct}
                isSelected={isSelected}
                compact={compact}
                onClick={() => {
                  onToggle(item.account.id)
                }}
              />
            )
          }

          const isSelected = selected.has(item.claim.id)
          const isMultisig = item.claim.keystores.length > 1
          const walletLabel = isMultisig ? 'Multisig' : (item.claim.keystores[0]?.wallet ?? 'unknown')
          const walletType: SupportedHardwareWallet | null = isMultisig
            ? null
            : (item.claim.keystores[0]?.wallet ?? null)
          const cardProps = isMultisig ? mapClaimToClaimCardProps(item.claim) : null

          const claimStatus = ensureClaimStatusNotExpired(item.claim)

          return (
            <AccountPill
              key={item.claim.id}
              name={item.claim.displayName}
              provider={walletLabel}
              walletType={walletType}
              keystores={cardProps?.keystores}
              isPending={claimStatus === 'pending'}
              btcAmount={btcAmount}
              pct={pct}
              isSelected={isSelected}
              isHistorySyncing={historySyncingAccountIds.includes(item.claim.id)}
              isHistorySynced={recentlySyncedAccountIds.includes(item.claim.id)}
              compact={compact}
              onClick={() => {
                onToggle(item.claim.id)
              }}
            />
          )
        })}
      </Stack>

      {/* Selection summary */}
      {!isShowingAll &&
        (compact ? (
          <Box mt={3} px={2.5} py={2} bg="neutral.50" borderRadius="8px">
            <Text textStyle="text/xs" fontWeight="semibold" color="neutral.900">
              {selected.size} selected
            </Text>
            <Text textStyle="text/xs" fontWeight="bold" color="neutral.900" fontFamily="mono">
              {(selectedBtcSats / 100_000_000).toFixed(8)} BTC
            </Text>
          </Box>
        ) : (
          <Box mt={5} px={4} py={3} bg="neutral.50" borderRadius="10px">
            <Flex align="center" gap={1.5} flexWrap="wrap">
              <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900">
                {selected.size}
              </Text>
              <Text textStyle="text/sm" color="neutral.500">
                selected
              </Text>
              <Text textStyle="text/sm" color="neutral.300">
                ·
              </Text>
              <Text textStyle="text/sm" fontWeight="bold" color="neutral.900" fontFamily="mono">
                {(selectedBtcSats / 100_000_000).toFixed(8)}
              </Text>
              <Text textStyle="text/sm" color="neutral.400">
                BTC
              </Text>
            </Flex>
          </Box>
        ))}
    </Box>
  )
}

interface ExchangeAccountPillProps {
  name: string
  exchange: string
  btcAmount: number
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
  pct,
  isSelected,
  needsReconnect,
  compact,
  onClick,
}: ExchangeAccountPillProps): JSX.Element {
  const config = exchangeConfig[exchange] ?? defaultExchangeConfig
  return (
    <Box
      onClick={onClick}
      px={compact ? 2.5 : 4}
      py={compact ? 2 : 3.5}
      mt={compact && needsReconnect ? 1 : 0}
      borderRadius={compact ? '8px' : '12px'}
      border="1px solid"
      borderColor={isSelected && !needsReconnect ? 'neutral.900' : 'neutral.200'}
      bg={needsReconnect || isSelected ? 'neutral.50' : 'shades.0'}
      cursor="pointer"
      transition="all 0.15s ease"
      position="relative"
      _hover={!isSelected ? { shadow: 'sm', ...(compact ? {} : { transform: 'translateY(-1px)' }) } : undefined}
    >
      {/* Check indicator — full mode only */}
      {isSelected && !needsReconnect && <SelectedCheckmark compact={compact} />}
      {compact && needsReconnect && <StatusBadge label="Reconnect" tone="error" />}

      <Flex align="center" gap={compact ? 2 : 2.5} mb={compact ? 1 : 2}>
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
            textStyle={compact ? 'text/xs' : 'text/md'}
            fontWeight="semibold"
            color={needsReconnect ? 'neutral.500' : 'neutral.900'}
            isTruncated
            flex={1}
          >
            {compact ? config.label : name}
          </Text>
        </Tooltip>
        {!compact && !needsReconnect && !isSelected && (
          <Text textStyle="label/sm" color="neutral.500" fontWeight="semibold" flexShrink={0}>
            {pct}%
          </Text>
        )}
      </Flex>

      {compact ? (
        <Flex align="center" justify="space-between" pl="28px">
          <Text
            fontFamily="mono"
            textStyle="text/xs"
            fontWeight="semibold"
            color={needsReconnect ? 'neutral.400' : 'neutral.600'}
          >
            {needsReconnect ? '—' : btcAmount.toFixed(8)}
          </Text>
          {!needsReconnect && <MiniPieChart pct={parseFloat(pct)} />}
        </Flex>
      ) : (
        <>
          <Flex align="center" justify="space-between">
            <Flex align="center" gap={1.5}>
              <Text textStyle="label/sm" color="neutral.500">
                {config.label}
              </Text>
              {needsReconnect && (
                <Text textStyle="label/xs" color="error.500" fontWeight="medium">
                  · Reconnect
                </Text>
              )}
            </Flex>
            <Text
              fontFamily="mono"
              textStyle="text/sm"
              fontWeight="semibold"
              color={needsReconnect ? 'neutral.400' : 'neutral.600'}
            >
              {needsReconnect ? '—' : btcAmount.toFixed(8)}
            </Text>
          </Flex>
          {!needsReconnect && <ProportionBar pct={pct} isSelected={isSelected} />}
        </>
      )}
    </Box>
  )
}

interface ManualAccountPillProps {
  name: string
  btcAmount: number
  pct: string
  isSelected: boolean
  compact: boolean
  onClick: () => void
}

function ManualAccountPill({
  name,
  btcAmount,
  pct,
  isSelected,
  compact,
  onClick,
}: ManualAccountPillProps): JSX.Element {
  return (
    <Box
      onClick={onClick}
      px={compact ? 2.5 : 4}
      py={compact ? 2 : 3.5}
      mt={compact ? 1 : 0}
      borderRadius={compact ? '8px' : '12px'}
      border="1px solid"
      borderColor={compact ? 'warning.300' : isSelected ? 'neutral.900' : 'neutral.200'}
      bg={isSelected ? 'neutral.50' : 'shades.0'}
      cursor="pointer"
      transition="all 0.15s ease"
      position="relative"
      _hover={!isSelected ? { shadow: 'sm', ...(compact ? {} : { transform: 'translateY(-1px)' }) } : undefined}
    >
      {isSelected && <SelectedCheckmark compact={compact} />}
      {compact && <StatusBadge label="Manually Added" />}

      <Flex align="center" gap={compact ? 2 : 2.5} mb={compact ? 1 : 2}>
        <Flex
          w={compact ? '20px' : '32px'}
          h={compact ? '20px' : '32px'}
          borderRadius={compact ? '4px' : '8px'}
          bg="warning.50"
          align="center"
          justify="center"
          flexShrink={0}
        >
          <ManualNoteIcon boxSize={compact ? '12px' : '18px'} />
        </Flex>
        <Tooltip label={name} openDelay={300} hasArrow>
          <Text
            textStyle={compact ? 'text/xs' : 'text/md'}
            fontWeight="semibold"
            color="neutral.900"
            isTruncated
            flex={1}
          >
            {name}
          </Text>
        </Tooltip>
        {!compact && !isSelected && (
          <Text textStyle="label/sm" color="neutral.500" fontWeight="semibold" flexShrink={0}>
            {pct}%
          </Text>
        )}
      </Flex>

      {compact ? (
        <Flex align="center" justify="space-between" pl="28px">
          <Text fontFamily="mono" textStyle="text/xs" fontWeight="semibold" color="neutral.600">
            {btcAmount.toFixed(8)}
          </Text>
          <MiniPieChart pct={parseFloat(pct)} />
        </Flex>
      ) : (
        <>
          <Flex align="center" justify="space-between">
            <Text textStyle="label/xs" color="warning.500" fontWeight="medium">
              Manually Added
            </Text>
            <Text fontFamily="mono" textStyle="text/sm" fontWeight="semibold" color="neutral.600">
              {btcAmount.toFixed(8)}
            </Text>
          </Flex>
          <ProportionBar pct={pct} isSelected={isSelected} />
        </>
      )}
    </Box>
  )
}

function ManualNoteIcon(props: { boxSize?: string }): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" color="warning.500" {...props}>
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
      onClick={onClick}
      px={compact ? 2.5 : 4}
      py={compact ? 2 : 3.5}
      mt={compact && isPending ? 1 : 0}
      borderRadius={compact ? '8px' : '12px'}
      border="1px solid"
      borderColor={compact && isPending ? 'warning.300' : isSelected ? 'neutral.900' : 'neutral.200'}
      bg={isSelected ? 'neutral.50' : 'shades.0'}
      cursor="pointer"
      transition="all 0.15s ease"
      position="relative"
      _hover={!isSelected ? { shadow: 'sm', ...(compact ? {} : { transform: 'translateY(-1px)' }) } : undefined}
    >
      {/* Check indicator — full mode only */}
      {isSelected && <SelectedCheckmark compact={compact} />}
      {compact && isPending && <StatusBadge label="Pending" />}

      {/* Logo + Name */}
      <Flex align="center" gap={compact ? 2 : 2.5} mb={compact ? 1 : 2}>
        {isMultisig ? (
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
          <Text
            textStyle={compact ? 'text/xs' : 'text/md'}
            fontWeight="semibold"
            color="neutral.900"
            isTruncated
            flex={1}
          >
            {name}
          </Text>
        </Tooltip>
        {!compact && !isSelected && (
          <Text textStyle="label/sm" color="neutral.500" fontWeight="semibold" flexShrink={0}>
            {pct}%
          </Text>
        )}
        {isHistorySyncing && <HistorySyncSpinner compact={compact} />}
        {!isHistorySyncing && isHistorySynced && <HistorySyncedCheckmark compact={compact} />}
      </Flex>

      {compact ? (
        <Flex align="center" justify="space-between" pl="28px">
          <Text fontFamily="mono" textStyle="text/xs" fontWeight="semibold" color="neutral.600">
            {btcAmount.toFixed(8)}
          </Text>
          <MiniPieChart pct={parseFloat(pct)} />
        </Flex>
      ) : (
        <>
          <Flex align="center" justify="space-between">
            <Flex align="center" gap={1.5}>
              <Text textStyle="label/sm" color="neutral.500" textTransform="capitalize">
                {provider}
              </Text>
              {isPending && (
                <Text textStyle="label/xs" color="warning.500" fontWeight="medium">
                  · Pending
                </Text>
              )}
              {isHistorySyncing && (
                <Text textStyle="label/xs" color="neutral.400" fontWeight="medium">
                  · Updating history
                </Text>
              )}
            </Flex>
            <Text fontFamily="mono" textStyle="text/sm" fontWeight="semibold" color="neutral.600">
              {btcAmount.toFixed(8)}
            </Text>
          </Flex>
          <ProportionBar pct={pct} isSelected={isSelected} />
        </>
      )}
    </Box>
  )
}

function HistorySyncSpinner({ compact }: { compact: boolean }): JSX.Element {
  return (
    <Tooltip label="Updating history" openDelay={250} hasArrow>
      <Spinner
        size="xs"
        color="neutral.400"
        flexShrink={0}
        ml={compact ? 0 : 0.5}
        w={compact ? '10px' : '12px'}
        h={compact ? '10px' : '12px'}
      />
    </Tooltip>
  )
}

function HistorySyncedCheckmark({ compact }: { compact: boolean }): JSX.Element {
  return (
    <Tooltip label="History updated" openDelay={250} hasArrow>
      <Box
        flexShrink={0}
        ml={compact ? 0 : 0.5}
        sx={{
          animation: 'historySyncedFade 5s ease forwards',
          '@keyframes historySyncedFade': {
            '0%, 72%': { opacity: 1 },
            '100%': { opacity: 0 },
          },
        }}
      >
        <CheckCircleFilledIcon color="success.600" color2="white" boxSize={compact ? '12px' : '14px'} />
      </Box>
    </Tooltip>
  )
}

function SelectedCheckmark({ compact }: { compact: boolean }): JSX.Element {
  const size = compact ? '14px' : '18px'
  const iconSize = compact ? '8px' : '10px'
  return (
    <Flex
      position="absolute"
      top="-7px"
      right="-7px"
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
      position="absolute"
      top="-9px"
      left="50%"
      transform="translateX(-50%)"
      px={2}
      py={0.5}
      bg={colors.bg}
      border="1px solid"
      borderColor={colors.border}
      borderRadius="full"
      whiteSpace="nowrap"
    >
      <Text textStyle="label/xs" color={colors.text} fontWeight="semibold" lineHeight="1">
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
      <Box as="svg" w={`${size}px`} h={`${size}px`} flexShrink={0} transform="rotate(-90deg)" cursor="default">
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
          opacity={0.4}
        />
      </Box>
    </Tooltip>
  )
}

function ProportionBar({ pct, isSelected }: { pct: string; isSelected: boolean }): JSX.Element {
  return (
    <Box h="2px" bg="neutral.100" borderRadius="1px" mt={2.5} overflow="hidden">
      <Box
        h="100%"
        w={`${Math.max(parseFloat(pct), 2)}%`}
        bg="neutral.900"
        borderRadius="1px"
        opacity={isSelected ? 0.35 : 0.15}
        transition="opacity 0.15s"
      />
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
            <CheckCircleFilledIcon color="success.600" color2="white" boxSize="10px" />
          </KeystoreAvatar.Badge>
        )}
      </KeystoreAvatar>
    </Box>
  )
}
