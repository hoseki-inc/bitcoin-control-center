import { Box, Flex, Image, Stack, Text, useColorModeValue } from '@chakra-ui/react'
import { type MouseEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ONBOARDING_KEY } from '../components/onboarding/getting-started'
import { useAccounts } from '../hooks/use-accounts'
import { useAppearance } from '../hooks/use-appearance'
import { useLocalSetting } from '../hooks/use-local-settings'
import { usePrivacy } from '../hooks/use-privacy'
import { AccountGrid } from './account-grid'
import { type ContextMenuAnchor, anchorFromEvent, useContextMenu } from './context-menu'
import { Entrance } from './entrance'
import { SearchPill } from './search/search-pill'
import { WallpaperPicker } from './wallpaper-picker'
import { ConnectionsWidget, HoldingsWidget, PriceWidget, VerificationWidget } from './widgets/desktop-widgets'

export function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) {
    return 'Good morning'
  }
  if (hour < 18) {
    return 'Good afternoon'
  }
  return 'Good evening'
}

/** The home screen behind every sheet: greeting, widgets, and accounts as app icons. */
export function Desktop({ covered, onOpenSearch }: { covered: boolean; onOpenSearch: () => void }): JSX.Element {
  const navigate = useNavigate()
  const { data: name } = useLocalSetting('user_name')
  const onboarding = useLocalSetting(ONBOARDING_KEY)
  const accounts = useAccounts()
  const logo = useColorModeValue('/hoseki-logo.svg', '/hoseki-logo-light.svg')
  const firstName = typeof name === 'string' ? name.trim().split(/\s+/)[0] : ''
  const greeting = `${greetingFor(new Date())}${firstName !== undefined && firstName !== '' ? `, ${firstName}` : ''}.`
  const { preference, setPreference } = useAppearance()
  const { hidden, toggle } = usePrivacy()
  const { open, menu } = useContextMenu('Desktop')
  const [wallpaperAnchor, setWallpaperAnchor] = useState<ContextMenuAnchor | null>(null)

  // First run: with nothing tracked and no onboarding choice yet, open Getting Started.
  const firstRun =
    !accounts.isLoading &&
    !accounts.isError &&
    accounts.totals.accountCount === 0 &&
    !onboarding.isLoading &&
    !onboarding.isError &&
    onboarding.data === null
  useEffect(() => {
    if (firstRun && !covered) {
      void navigate('/getting-started', { replace: true })
    }
  }, [firstRun, covered, navigate])

  const openDesktopMenu = (event: MouseEvent<HTMLElement>): void => {
    const anchor = anchorFromEvent(event)
    open(event, [
      {
        label: 'Add account',
        onSelect: () => {
          void navigate('/accounts/add')
        },
      },
      {
        label: 'Change wallpaper…',
        onSelect: () => {
          setWallpaperAnchor(anchor)
        },
      },
      { divider: true },
      {
        label: 'Light',
        checked: preference === 'light',
        onSelect: () => {
          setPreference('light')
        },
      },
      {
        label: 'Dark',
        checked: preference === 'dark',
        onSelect: () => {
          setPreference('dark')
        },
      },
      {
        label: 'Match system',
        checked: preference === 'system',
        onSelect: () => {
          setPreference('system')
        },
      },
      { divider: true },
      { label: hidden ? 'Show balances' : 'Hide balances', onSelect: toggle },
    ])
  }

  return (
    <Box
      position="relative"
      zIndex={1}
      h="100dvh"
      overflowY="auto"
      px={{ base: 3, md: 8 }}
      pt={{ base: 14, md: 16 }}
      pb="140px"
      // Hidden instantly under a sheet, faded back when the sheet closes.
      opacity={covered ? 0 : 1}
      visibility={covered ? 'hidden' : 'visible'}
      transition={covered ? 'none' : 'opacity 150ms ease-out'}
      aria-hidden={covered}
      onContextMenu={openDesktopMenu}
    >
      <Stack align="center" spacing={{ base: 6, md: 8 }}>
        <Stack align="center" spacing={4}>
          <Image src={logo} alt="Hoseki" h={{ base: '26px', md: '34px' }} />
          <Text
            as="h1"
            textStyle={{ base: 'text/3xl', md: 'text/5xl' }}
            fontWeight="semibold"
            letterSpacing="-0.02em"
            textAlign="center"
            color="text.primary"
            textShadow="0 1px 12px var(--focus-band)"
          >
            {greeting}
          </Text>
        </Stack>

        <Flex as="section" aria-label="Overview" wrap="wrap" justify="center" gap={{ base: 3, md: 6 }} maxW="1200px">
          <Entrance index={0} kind="widget">
            <HoldingsWidget accounts={accounts} />
          </Entrance>
          <Entrance index={1} kind="widget">
            <PriceWidget />
          </Entrance>
          <Entrance index={2} kind="widget">
            <ConnectionsWidget accounts={accounts} />
          </Entrance>
          <Entrance index={3} kind="widget">
            <VerificationWidget accounts={accounts} />
          </Entrance>
        </Flex>

        <Box as="section" aria-label="Accounts" w="100%">
          <AccountGrid accounts={accounts.accounts} />
        </Box>
      </Stack>
      <SearchPill onOpen={onOpenSearch} />
      {menu}
      {wallpaperAnchor !== null && (
        <WallpaperPicker
          anchor={wallpaperAnchor}
          onClose={() => {
            setWallpaperAnchor(null)
          }}
        />
      )}
    </Box>
  )
}
