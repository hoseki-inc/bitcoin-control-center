import { ChartLine, FileText, House, type LucideIcon, Settings, Wallet } from 'lucide-react'

export interface Section {
  id: 'home' | 'accounts' | 'portfolio' | 'statements' | 'settings'
  label: string
  path: string
  /** Path prefixes that belong to this section (the first match wins). */
  matches: readonly string[]
  icon: LucideIcon
  /** Icon tile gradient, top to bottom. */
  tile: readonly [string, string]
  /** Glyph colour on the tile. */
  glyph: string
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'home',
    label: 'Home',
    path: '/home',
    matches: ['/home'],
    icon: House,
    tile: ['#FFE98A', '#F2B200'],
    glyph: '#1A1300',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    path: '/accounts',
    matches: ['/accounts', '/multisig', '/getting-started'],
    icon: Wallet,
    tile: ['#6A8BE6', '#2D3F8C'],
    glyph: '#FFFFFF',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    path: '/portfolio',
    matches: ['/portfolio'],
    icon: ChartLine,
    tile: ['#3FDDA3', '#047857'],
    glyph: '#FFFFFF',
  },
  {
    id: 'statements',
    label: 'Statements',
    path: '/statements',
    matches: ['/statements'],
    icon: FileText,
    tile: ['#FDC08A', '#EA580C'],
    glyph: '#FFFFFF',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    matches: ['/settings'],
    icon: Settings,
    tile: ['#A3B1C6', '#334155'],
    glyph: '#FFFFFF',
  },
]

export function sectionForPath(pathname: string): Section | undefined {
  return SECTIONS.find((section) =>
    section.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  )
}

/** The desktop is visible at /home (and the bare root, which redirects there); everything else opens a sheet. */
export function isSheetPath(pathname: string): boolean {
  return pathname !== '/' && pathname !== '/home'
}
