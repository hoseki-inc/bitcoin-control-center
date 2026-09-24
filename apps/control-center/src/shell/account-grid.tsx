import { Box, Flex, Grid, Image, Text } from '@chakra-ui/react'
import { getSupportedHardwareWalletLogoPath } from '@hoseki/packages/wallet/logo'
import { Bitcoin, ChartNoAxesCombined, Check, KeyRound, type LucideIcon, NotebookPen, Plus } from 'lucide-react'
import { type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { type AccountSummary } from '../hooks/use-accounts'
import { useContextMenu } from './context-menu'
import { Entrance } from './entrance'

const DEFAULT_EXCHANGE_LOGO = '/images/exchanges/coinbase.svg'
const EXCHANGE_LOGOS: Record<string, string> = {
  coinbase: '/images/exchanges/coinbase.svg',
  kraken: '/images/exchanges/kraken.svg',
  robinhood: '/images/exchanges/robinhood-icon.svg',
  strike: '/images/exchanges/strike-icon.svg',
}

/** A light chip for brand marks, which are drawn for light backgrounds. */
function MarkTile({ src, alt }: { src: string; alt: string }): JSX.Element {
  return (
    <Flex w="100%" h="100%" align="center" justify="center" bg="rgb(255 255 255 / 0.94)" borderRadius="inherit">
      <Image src={src} alt={alt} w="58%" h="58%" objectFit="contain" />
    </Flex>
  )
}

function GlyphTile({
  from,
  to,
  icon: Icon,
  glyph = '#FFFFFF',
  caption,
}: {
  from: string
  to: string
  icon: LucideIcon
  glyph?: string
  caption?: string | null
}): JSX.Element {
  return (
    <Flex
      w="100%"
      h="100%"
      direction="column"
      align="center"
      justify="center"
      gap="1px"
      bg={`linear-gradient(160deg, ${from}, ${to})`}
      borderRadius="inherit"
      color={glyph}
    >
      <Icon size={caption ? '40%' : '46%'} strokeWidth={2} aria-hidden />
      {caption && (
        <Text as="span" fontSize="10px" lineHeight="1" fontWeight="semibold" opacity={0.85}>
          {caption}
        </Text>
      )}
    </Flex>
  )
}

function AccountArtwork({ account }: { account: AccountSummary }): JSX.Element {
  switch (account.kind) {
    case 'wallet':
      return account.wallet === null ? (
        <GlyphTile from="#FDBA5C" to="#E8750A" icon={Bitcoin} />
      ) : (
        <MarkTile src={getSupportedHardwareWalletLogoPath(account.wallet)} alt="" />
      )
    case 'multisig':
      return <GlyphTile from="#8B9CF4" to="#3B4AA8" icon={KeyRound} caption={account.quorum} />
    case 'exchange':
      return <MarkTile src={EXCHANGE_LOGOS[account.exchange ?? ''] ?? DEFAULT_EXCHANGE_LOGO} alt="" />
    case 'manual':
      return <GlyphTile from="#FDE68A" to="#D99A06" icon={NotebookPen} glyph="#3A2A00" />
    case 'etf':
      return <GlyphTile from="#5EEAD4" to="#0F766E" icon={ChartNoAxesCombined} />
  }
}

function StatusBadge({ state }: { state: AccountSummary['state'] }): JSX.Element | null {
  if (state === 'connected' || state === 'manual') return null
  const style =
    state === 'verified'
      ? { bg: 'status.success.solid', label: 'Verified' }
      : state === 'pending'
        ? { bg: 'status.warning.solid', label: 'Awaiting signature' }
        : { bg: 'status.error.solid', label: 'Reconnect needed' }
  return (
    <Flex
      position="absolute"
      top="-4px"
      right="-4px"
      boxSize="18px"
      borderRadius="full"
      bg={style.bg}
      color="white"
      align="center"
      justify="center"
      boxShadow="0 0 0 2px var(--focus-band), 0 1px 3px rgb(0 0 0 / 0.3)"
      title={style.label}
    >
      {state === 'verified' ? (
        <Check size={11} strokeWidth={3.5} aria-hidden />
      ) : (
        <Text as="span" fontSize="11px" fontWeight="bold" lineHeight="1">
          !
        </Text>
      )}
    </Flex>
  )
}

const iconShape = {
  boxSize: { base: '52px', md: '64px' },
  borderRadius: { base: '12px', md: '15px' },
} as const

function IconCell({
  to,
  label,
  description,
  artwork,
  badge,
  onContextMenu,
}: {
  to: string
  label: string
  description: string
  artwork: ReactNode
  badge?: ReactNode
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void
}): JSX.Element {
  return (
    <Box
      as={Link}
      to={to}
      role="group"
      data-desktop-item
      aria-label={`${label}, ${description}`}
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap={2}
      w={{ base: '76px', md: '104px' }}
      py={2}
      borderRadius="16px"
      outline="none"
      onContextMenu={onContextMenu}
    >
      <Box
        position="relative"
        {...iconShape}
        boxShadow="0 4px 12px rgb(0 0 0 / 0.18)"
        transition="transform 300ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1)"
        _groupHover={{ transform: 'scale(1.1)', boxShadow: '0 0 0 6px var(--glass-edge), 0 6px 16px rgb(0 0 0 / 0.2)' }}
        _groupFocusVisible={{ transform: 'scale(1.1)', boxShadow: '0 0 0 3px var(--hoseki-colors-focus-ring)' }}
        _groupActive={{ transform: 'scale(0.95)' }}
      >
        <Box w="100%" h="100%" borderRadius="inherit" overflow="hidden">
          {artwork}
        </Box>
        {badge}
      </Box>
      <Text
        textStyle={{ base: 'text/xs', md: 'text/sm' }}
        fontWeight="medium"
        textAlign="center"
        color="text.primary"
        noOfLines={1}
        maxW="100%"
        px={1}
        textShadow="0 1px 8px var(--focus-band)"
      >
        {label}
      </Text>
    </Box>
  )
}

const DESCRIPTIONS: Record<AccountSummary['state'], string> = {
  verified: 'verified',
  pending: 'awaiting a signature',
  connected: 'connected',
  reconnect: 'needs reconnecting',
  manual: 'tracked manually',
}

/** Accounts as app icons. Each opens its detail page in a sheet; right-click for more. */
export function AccountGrid({ accounts }: { accounts: readonly AccountSummary[] }): JSX.Element {
  const navigate = useNavigate()
  const { open, menu } = useContextMenu('Account actions')

  return (
    <>
      <Grid
        templateColumns={{ base: 'repeat(auto-fill, 76px)', md: 'repeat(auto-fill, 104px)' }}
        justifyContent="center"
        columnGap={{ base: 3, md: 6 }}
        rowGap={{ base: 1, md: 3 }}
        w="100%"
        maxW={{ base: '100%', md: `${6 * 104 + 5 * 24}px` }}
        mx="auto"
      >
        {accounts.map((account, index) => (
          <Entrance key={`${account.kind}-${account.id}`} index={index} kind="item">
            <IconCell
              to={account.to}
              label={account.name}
              description={DESCRIPTIONS[account.state]}
              artwork={<AccountArtwork account={account} />}
              badge={<StatusBadge state={account.state} />}
              onContextMenu={(event) =>
                open(event, [
                  { label: 'Open', onSelect: () => navigate(account.to) },
                  ...(account.state === 'pending'
                    ? [{ label: 'Verify ownership', onSelect: () => navigate(account.to) }]
                    : []),
                  ...(account.state === 'reconnect'
                    ? [{ label: 'Reconnect', onSelect: () => navigate(account.to) }]
                    : []),
                  { divider: true as const },
                  { label: 'Create statement', onSelect: () => navigate('/statements/create') },
                ])
              }
            />
          </Entrance>
        ))}
        <Entrance index={accounts.length} kind="item">
          <IconCell
            to="/accounts/add"
            label="Add account"
            description="connect a wallet or exchange, or track holdings manually"
            artwork={
              <Flex
                w="100%"
                h="100%"
                align="center"
                justify="center"
                borderRadius="inherit"
                border="1.5px dashed"
                borderColor="border.strong"
                bg="var(--material-tint)"
                sx={{ backdropFilter: 'var(--material-filter)' }}
                color="text.secondary"
              >
                <Plus size="40%" strokeWidth={2} aria-hidden />
              </Flex>
            }
          />
        </Entrance>
      </Grid>
      {menu}
    </>
  )
}
