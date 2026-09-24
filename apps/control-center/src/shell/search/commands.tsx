import { Box, Flex, useColorMode } from '@chakra-ui/react'
import {
  Eye,
  EyeOff,
  FilePlus2,
  type LucideIcon,
  Monitor,
  Moon,
  PlusCircle,
  Rocket,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { type AccountSummary, useAccounts } from '../../hooks/use-accounts'
import { useAppearance } from '../../hooks/use-appearance'
import { usePrivacy } from '../../hooks/use-privacy'
import { isDesktop } from '../../mode'
import { AccountArtwork } from '../account-grid'
import { DockTile } from '../dock'
import { SECTIONS } from '../sections'
import { WALLPAPER_FAMILIES, WALLPAPER_PRESETS } from '../wallpaper/presets'
import { useWallpaperThumbnails } from '../wallpaper/thumbnails'
import { useBlockSeed, useWallpaper } from '../wallpaper/use-wallpaper'
import { type Searchable } from './score'

export type CommandGroup = 'Suggestions' | 'Accounts' | 'Go to' | 'Actions' | 'Wallpaper' | 'Settings'

export interface Command extends Searchable {
  id: string
  group: CommandGroup
  /** Short context shown after the label, e.g. "in Settings". */
  detail?: string
  icon: ReactNode
  run: () => void
  /** Only offered once the user types, so the empty state stays short. */
  searchOnly?: boolean
}

const ICON_SIZE = '28px'

function Tile({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Box boxSize={ICON_SIZE} borderRadius="8px" overflow="hidden" flexShrink={0} boxShadow="0 1px 3px rgb(0 0 0 / 0.2)">
      {children}
    </Box>
  )
}

function ActionTile({ icon: Icon, from, to }: { icon: LucideIcon; from: string; to: string }): JSX.Element {
  return (
    <Tile>
      <DockTile tile={[from, to]} glyph="#FFFFFF" icon={Icon} />
    </Tile>
  )
}

const KIND_LABEL: Record<AccountSummary['kind'], string> = {
  wallet: 'Self-custody wallet',
  multisig: 'Multisig vault',
  exchange: 'Exchange',
  manual: 'Manual holding',
  etf: 'ETF holding',
}

const STATE_LABEL: Record<AccountSummary['state'], string> = {
  verified: 'Verified',
  pending: 'Awaiting signature',
  connected: 'Connected',
  reconnect: 'Reconnect needed',
  manual: 'Tracked manually',
}

/** Everything the command palette can find, built from live app state. */
export function useCommands(): { commands: Command[]; accounts: AccountSummary[] } {
  const navigate = useNavigate()
  const { accounts } = useAccounts()
  const { hidden, toggle } = usePrivacy()
  const { preference, resolved, setPreference } = useAppearance()
  const { colorMode } = useColorMode()
  const { preset, setWallpaper } = useWallpaper()
  const seed = useBlockSeed(true)
  const thumbnails = useWallpaperThumbnails(colorMode === 'dark' ? 'dark' : 'light', seed)

  const commands = useMemo((): Command[] => {
    const go = (to: string) => () => navigate(to)
    const sections: Command[] = SECTIONS.map((section) => ({
      id: `go-${section.id}`,
      group: 'Go to',
      label: section.label,
      keywords: section.id === 'settings' ? ['preferences'] : section.id === 'home' ? ['desktop'] : [],
      icon: (
        <Tile>
          <DockTile tile={section.tile} glyph={section.glyph} icon={section.icon} />
        </Tile>
      ),
      run: go(section.path),
    }))

    const shortcuts: Command[] = [
      {
        id: 'add-account',
        group: 'Go to',
        label: 'Add account',
        keywords: ['connect', 'wallet', 'exchange', 'ledger', 'trezor', 'coldcard', 'keystone', 'new'],
        icon: <ActionTile icon={PlusCircle} from="#6A8BE6" to="#2D3F8C" />,
        run: go('/accounts/add'),
      },
      {
        id: 'create-statement',
        group: 'Go to',
        label: 'Create statement',
        keywords: ['pdf', 'proof of reserves', 'report', 'export'],
        icon: <ActionTile icon={FilePlus2} from="#FDC08A" to="#EA580C" />,
        run: go('/statements/create'),
      },
      {
        id: 'getting-started',
        group: 'Go to',
        label: 'Getting started',
        keywords: ['introduction', 'onboarding', 'help', 'tour'],
        icon: <ActionTile icon={Rocket} from="#C9B8FF" to="#6D28D9" />,
        run: go('/getting-started'),
        searchOnly: true,
      },
    ]

    const accountCommands: Command[] = accounts.map((account) => ({
      id: `account-${account.kind}-${account.id}`,
      group: 'Accounts',
      label: account.name,
      detail: `${KIND_LABEL[account.kind]} · ${STATE_LABEL[account.state]}`,
      keywords: [KIND_LABEL[account.kind], account.wallet ?? '', account.exchange ?? '', account.quorum ?? ''].filter(
        Boolean,
      ),
      icon: (
        <Tile>
          <AccountArtwork account={account} />
        </Tile>
      ),
      run: go(account.to),
      searchOnly: true,
    }))

    const actions: Command[] = [
      {
        id: 'privacy',
        group: 'Actions',
        label: hidden ? 'Show balances' : 'Hide balances',
        keywords: ['privacy', 'sensitive', 'mask', 'amounts'],
        icon: <ActionTile icon={hidden ? Eye : EyeOff} from="#C9B8FF" to="#6D28D9" />,
        run: toggle,
      },
      {
        id: 'theme-toggle',
        group: 'Actions',
        label: resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        keywords: ['appearance', 'theme', 'dark', 'light'],
        icon: <ActionTile icon={resolved === 'dark' ? Sun : Moon} from="#A3B1C6" to="#334155" />,
        run: () => setPreference(resolved === 'dark' ? 'light' : 'dark'),
      },
      ...(preference === 'system'
        ? []
        : [
            {
              id: 'theme-system',
              group: 'Actions' as const,
              label: 'Match system appearance',
              keywords: ['appearance', 'theme', 'automatic', 'os'],
              icon: <ActionTile icon={Monitor} from="#A3B1C6" to="#334155" />,
              run: () => setPreference('system'),
              searchOnly: true,
            },
          ]),
    ]

    const familyLabel = new Map(WALLPAPER_FAMILIES.map(({ family, label }) => [family, label]))
    const wallpapers: Command[] = WALLPAPER_PRESETS.map((option) => ({
      id: `wallpaper-${option.id}`,
      group: 'Wallpaper',
      label: `${option.name} wallpaper`,
      detail: option.id === preset.id ? 'Current' : familyLabel.get(option.family),
      keywords: ['wallpaper', 'background', familyLabel.get(option.family) ?? ''],
      icon: (
        <Tile>
          <Box
            w="100%"
            h="100%"
            bg={thumbnails[option.id] !== undefined ? `center / cover url(${thumbnails[option.id]})` : 'surface.muted'}
          />
        </Tile>
      ),
      run: () => setWallpaper(option.id),
      searchOnly: true,
    }))

    const settingsIcon = (
      <Tile>
        <DockTile tile={['#A3B1C6', '#334155']} glyph="#FFFFFF" icon={SettingsIcon} />
      </Tile>
    )
    const settings: Command[] = [
      { label: 'Your name', keywords: ['personal', 'statement name', 'greeting'] },
      { label: 'Appearance', keywords: ['theme', 'dark', 'light'] },
      { label: 'Wallpaper', keywords: ['background'] },
      { label: 'Bitcoin display', keywords: ['sats', 'btc', 'symbol', 'units', 'bip 177'] },
      ...(isDesktop ? [{ label: 'Electrum server', keywords: ['node', 'tor', 'connection'] }] : []),
    ].map((entry) => ({
      id: `settings-${entry.label}`,
      group: 'Settings' as const,
      label: entry.label,
      detail: 'in Settings',
      keywords: entry.keywords,
      icon: settingsIcon,
      run: go('/settings'),
      searchOnly: true,
    }))

    return [...sections, ...shortcuts, ...accountCommands, ...actions, ...settings, ...wallpapers]
  }, [accounts, hidden, navigate, preference, preset.id, resolved, setPreference, setWallpaper, thumbnails, toggle])

  return { commands, accounts }
}

/** Keyboard shortcut label for the platform. */
export const SEARCH_SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'

export function ShortcutHint({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Flex as="kbd" align="center" fontFamily="body" textStyle="text/xs" color="text.tertiary" letterSpacing="0.02em">
      {children}
    </Flex>
  )
}
