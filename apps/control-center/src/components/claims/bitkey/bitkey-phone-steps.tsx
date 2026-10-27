import { Box, type BoxProps, keyframes, useBreakpointValue } from '@chakra-ui/react'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightLeftIcon,
  ArrowUpIcon,
  BitcoinIcon,
  ChevronRightIcon,
  DownloadIcon,
  EllipsisIcon,
  FoldVerticalIcon,
  HandHeartIcon,
  LayersIcon,
  type LucideIcon,
  MinusIcon,
  PaletteIcon,
  PlusIcon,
  ShieldIcon,
  SmartphoneIcon,
  XIcon,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

export interface BitkeyExportStep {
  title: string
  body: string
}

/** Made-up transactions for the Wallet screen; their amounts stay hidden, as in Bitkey. */
const recentActivity = [
  { address: 'bc1q...7f3k', date: 'Oct 21 at 9:14 am' },
  { address: 'bc1p...m2xa', date: 'Oct 8 at 4:02 pm' },
  { address: 'bc1q...h8d4', date: 'Sep 30 at 11:47 am' },
]

/** Where the descriptor lives in the Bitkey app: Wallet → ••• → Settings → Exports → Current wallet descriptor. */
export const bitkeyExportSteps: BitkeyExportStep[] = [
  {
    title: 'Open Settings',
    body: 'In the Bitkey app on your phone, tap the three dots in the top right corner of your wallet.',
  },
  {
    title: 'Go to Exports',
    body: 'Under Advanced, tap Exports.',
  },
  {
    title: 'Choose Your Wallet Descriptor',
    body: 'Tap Current wallet descriptor. Bitkey calls it an XPUB bundle: it holds your wallet’s public keys, never its private keys.',
  },
  {
    title: 'Send It to This Device',
    body: 'Tap Download XPUB bundle. Copy the text, or AirDrop it to this device, then paste it on the next screen. Avoid email, which keeps copies on mail servers.',
  },
]

// The screens reproduce Bitkey's own app, so they use its measurements (iOS points on a 390 × 844 screen),
// colours and type scale rather than ours, and the whole screen is scaled down to fit.
const SCREEN_WIDTH = 390
const SCREEN_HEIGHT = 844
const BEZEL = 6

/**
 * The guide's phone on the page: smaller on narrow screens so the arrows under it stay in view.
 * The intro's picture takes the same height, so the text doesn't jump between steps.
 */
export interface BitkeyPhoneSize {
  width: number
  height: number
  /** From Bitkey's screen points to page pixels. */
  scale: number
}

export function useBitkeyPhoneSize(): BitkeyPhoneSize {
  const width = useBreakpointValue({ base: 184, md: 232 }, { ssr: false }) ?? 232
  const scale = (width - 2 * BEZEL) / SCREEN_WIDTH
  return { width, height: Math.round(SCREEN_HEIGHT * scale + 2 * BEZEL), scale }
}

const ease = 'cubic-bezier(0.16, 1, 0.3, 1)'
const duration = 420

const bitkey = {
  background: '#F3F1EC',
  raised: '#FFFFFF',
  pressed: '#EBE9E1',
  text: '#000000',
  secondary: '#5E5D5B',
  faint: '#C4C3C0',
  chevron: '#A4A29F',
  divider: '#E0DED8',
  scrim: 'rgba(0, 0, 0, 0.46)',
  grabber: '#AAA8A5',
  warningBackground: '#F4E6D4',
  warningText: '#7A3600',
}
const sans = "'Geist', sans-serif"
const mono = "'Roboto Mono', monospace"

// Bitkey's sheet also has a Cancel button; leaving it out keeps the step on the one button to tap,
// and the sheet sits lower by Cancel's height, as an iOS sheet sized to its content would.
const SHEET_TOP = 395 + 72

/** What to tap on each step, in screen points, placed where a thumb lands without covering the label. */
const taps: Array<{ x: number; y: number; size: number; onDark?: boolean }> = [
  // The ••• button's centre.
  { x: 326 + 22, y: 57 + 22, size: 58 },
  // The chevron on the Exports row, the third Advanced row.
  { x: SCREEN_WIDTH - 20 - 11, y: 570 + 2.5 * 57, size: 50 },
  // The download icon's centre on the Current wallet descriptor row.
  { x: SCREEN_WIDTH - 20 - 11, y: 248 + 31, size: 50 },
  // The right end of the Download XPUB bundle button, clear of its label.
  { x: 342, y: SHEET_TOP + 259 + 28, size: 54, onDark: true },
]

/**
 * The Bitkey app, showing each step of the export. Moving to the next step plays the move the phone makes:
 * Settings pushes in, Exports rises over it, and the export sheet slides up.
 */
export function BitkeyPhoneGuide({ step }: { step: number }): JSX.Element {
  const tap = taps[step]
  const phone = useBitkeyPhoneSize()

  return (
    <Box
      aria-hidden
      w={`${phone.width}px`}
      h={`${phone.height}px`}
      mx="auto"
      borderWidth={`${BEZEL}px`}
      borderColor="neutral.900"
      borderRadius={`${Math.round(phone.width * 0.164)}px`}
      overflow="hidden"
      bg={bitkey.background}
      sx={{ '@media (prefers-reduced-motion: reduce)': { '& *': { transitionProperty: 'opacity !important' } } }}
    >
      <Box
        position="relative"
        w={`${SCREEN_WIDTH}px`}
        h={`${SCREEN_HEIGHT}px`}
        transform={`scale(${phone.scale})`}
        transformOrigin="top left"
        overflow="hidden"
        sx={{ WebkitFontSmoothing: 'antialiased' }}
      >
        <Layer transform={step >= 1 ? 'translateX(-30%)' : 'none'}>
          <WalletScreen />
        </Layer>
        <Layer transform={step >= 1 ? 'none' : 'translateX(100%)'} isVisible={step >= 1}>
          <SettingsScreen />
        </Layer>
        <Layer transform={step >= 2 ? 'none' : 'translateY(100%)'} isVisible={step >= 2}>
          <ExportsScreen />
        </Layer>
        <StatusBar />
        <Layer bg={bitkey.scrim} isVisible={step >= 3} />
        <Layer
          top={`${SHEET_TOP}px`}
          bg={bitkey.background}
          borderTopRadius="28px"
          transform={step >= 3 ? 'none' : 'translateY(100%)'}
          isVisible={step >= 3}
        >
          <ExportSheet />
        </Layer>
        {tap && <Tap key={step} {...tap} />}
      </Box>
    </Box>
  )
}

/** A tiny phone on Bitkey's Wallet screen, drawn with the same screens as the guide. */
export function BitkeyPhoneThumbnail({ height }: { height: number }): JSX.Element {
  const bezel = 2
  const scale = (height - 2 * bezel) / SCREEN_HEIGHT
  const width = Math.round(SCREEN_WIDTH * scale + 2 * bezel)

  return (
    <Box
      aria-hidden
      flexShrink={0}
      w={`${width}px`}
      h={`${height}px`}
      borderWidth={`${bezel}px`}
      borderColor="neutral.900"
      borderRadius={`${Math.round(width * 0.2)}px`}
      overflow="hidden"
      bg={bitkey.background}
    >
      <Box
        position="relative"
        w={`${SCREEN_WIDTH}px`}
        h={`${SCREEN_HEIGHT}px`}
        transform={`scale(${scale})`}
        transformOrigin="top left"
      >
        <WalletScreen />
        <StatusBar />
      </Box>
    </Box>
  )
}

function Layer({ isVisible = true, children, ...props }: { isVisible?: boolean; children?: ReactNode } & BoxProps) {
  return (
    <Box
      position="absolute"
      inset={0}
      opacity={isVisible ? 1 : 0}
      transition={`transform ${duration}ms ${ease}, opacity ${isVisible ? 120 : duration}ms linear`}
      {...props}
    >
      {children}
    </Box>
  )
}

const tapIn = keyframes`
  from { opacity: 0; transform: scale(1.35); }
  to { opacity: 1; transform: scale(1); }
`
const tapRipple = keyframes`
  from { opacity: 0.55; transform: scale(1); }
  to { opacity: 0; transform: scale(1.7); }
`

/** A fingertip on the thing to tap, like iOS shows touches in screen recordings. */
function Tap({ x, y, size, onDark = false }: { x: number; y: number; size: number; onDark?: boolean }) {
  const ring = onDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.32)'
  return (
    <Box
      position="absolute"
      left={`${x - size / 2}px`}
      top={`${y - size / 2}px`}
      w={`${size}px`}
      h={`${size}px`}
      borderRadius="full"
      bg={onDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.1)'}
      boxShadow={`inset 0 0 0 3px ${ring}`}
      opacity={0}
      sx={{
        animation: `${tapIn} 260ms ${ease} ${duration - 60}ms forwards`,
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'full',
          boxShadow: `0 0 0 3px ${ring}`,
          opacity: 0,
          animation: `${tapRipple} 1200ms ${ease} ${duration + 300}ms 2`,
        },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 1, '&::after': { animation: 'none' } },
      }}
    />
  )
}

// ─── Bitkey screens ─────────────────────────────────────────────────────────

function StatusBar() {
  return (
    <>
      <Box position="absolute" left="132px" top="11px" w="126px" h="37px" borderRadius="19px" bg="#000" />
      <Label x={36} y={14} size={17} weight={600}>
        9:41
      </Label>
      <svg style={{ position: 'absolute', left: 284, top: 19 }} width="80" height="13" viewBox="0 0 80 13">
        <g fill={bitkey.text}>
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0.5" width="3" height="11.5" rx="1" opacity="0.3" />
          <path d="M33.5 3.2a9.6 9.6 0 0 1 12.4 0l-1.3 1.4a7.7 7.7 0 0 0-9.8 0zM36 6a5.7 5.7 0 0 1 7.4 0l-1.3 1.4a3.8 3.8 0 0 0-4.8 0zM38.4 8.8a2 2 0 0 1 2.6 0l-1.3 1.6z" />
          <rect x="54.5" y="1" width="22" height="11" rx="3.5" fill="none" stroke={bitkey.text} opacity="0.4" />
          <rect x="56.5" y="3" width="13" height="7" rx="2" />
          <path d="M78 4.5v4a2 2 0 0 0 0-4z" opacity="0.4" />
        </g>
      </svg>
    </>
  )
}

function WalletScreen() {
  return (
    <Screen>
      <Label x={20} y={60} size={30} letterSpacing={-0.5}>
        Wallet
      </Label>
      <RoundButton x={326} y={57} icon={EllipsisIcon} bg={bitkey.pressed} />
      <Box position="absolute" left={0} right={0} top="164px" display="flex" justifyContent="center" gap="10px">
        {[0, 1, 2, 3, 4].map((index) => (
          <Asterisk key={index} />
        ))}
      </Box>
      {[
        { label: 'BUY', icon: PlusIcon },
        { label: 'SELL', icon: MinusIcon },
        { label: 'SEND', icon: ArrowUpIcon },
        { label: 'RECEIVE', icon: ArrowDownIcon },
      ].map(({ label, icon }, index) => (
        <Box key={label} position="absolute" left={`${21 + index * 89}px`} top="283px" w="80px" textAlign="center">
          <Box w="80px" h="80px" borderRadius="full" bg={bitkey.raised} display="grid" placeItems="center">
            <Glyph icon={icon} size={30} strokeWidth={1.75} />
          </Box>
          <Box mt="13px" fontFamily={mono} fontSize="15px" lineHeight="20px" color={bitkey.text}>
            {label}
          </Box>
        </Box>
      ))}
      <Card x={20} y={432} w={350} h={97}>
        <Label x={16} y={14} size={14} font="mono" color={bitkey.secondary}>
          BITCOIN PRICE
        </Label>
        <Label x={16} y={38} size={20} letterSpacing={-0.4}>
          $80,209.00
        </Label>
        <Box position="absolute" left="14px" top="68px" display="flex" alignItems="center" gap="4px">
          <Glyph icon={ArrowUpIcon} size={15} strokeWidth={2} color={bitkey.secondary} />
          <Box fontFamily={sans} fontSize="14px" lineHeight="18px" color={bitkey.secondary}>
            0.01% today
          </Box>
        </Box>
        <svg style={{ position: 'absolute', left: 190, top: 22 }} width="144" height="56" viewBox="0 0 144 56">
          <path
            d="M2 32 L8 4 L14 46 L20 12 L28 26 L34 20 L42 36 L48 42 L56 30 L62 38 L70 24 L80 40 L88 48 L96 44 L104 50 L110 38 L118 46 L126 50 L132 30 L136 34 L142 8"
            fill="none"
            stroke={bitkey.text}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </Card>
      <Label x={20} y={571} size={15} font="mono" letterSpacing={0.6}>
        RECENT ACTIVITY
      </Label>
      {recentActivity.map(({ address, date }, index) => (
        <Box
          key={address}
          position="absolute"
          left="20px"
          right="20px"
          top={`${614 + index * 80}px`}
          h="44px"
          display="flex"
          alignItems="center"
          gap="12px"
        >
          <Box w="44px" h="44px" flexShrink={0} borderRadius="full" bg={bitkey.text} display="grid" placeItems="center">
            <Glyph icon={BitcoinIcon} size={24} strokeWidth={2.5} color={bitkey.raised} />
          </Box>
          <Box flex={1} fontFamily={sans} lineHeight="22px">
            <Box fontSize="18px" color={bitkey.text}>
              {address}
            </Box>
            <Box fontSize="16px" color={bitkey.secondary}>
              {date}
            </Box>
          </Box>
          <Box display="flex" gap="3px">
            {[0, 1, 2, 3, 4].map((asterisk) => (
              <Asterisk key={asterisk} size={15} />
            ))}
          </Box>
        </Box>
      ))}
      <Box
        position="absolute"
        left="115px"
        top="745px"
        w="160px"
        h="59px"
        borderRadius="30px"
        bg={bitkey.raised}
        boxShadow="0 6px 16px rgba(0, 0, 0, 0.08)"
        display="flex"
        alignItems="center"
        p="4px"
      >
        <Box w="80px" h="51px" borderRadius="26px" bg={bitkey.pressed} display="grid" placeItems="center">
          <Box w="22px" h="16px" borderRadius="3px" bg={bitkey.text} />
        </Box>
        <Box flex={1} display="grid" placeItems="center">
          <Glyph icon={ShieldIcon} size={22} color={bitkey.chevron} />
        </Box>
      </Box>
    </Screen>
  )
}

function SettingsScreen() {
  return (
    <Screen boxShadow="-8px 0 24px rgba(0, 0, 0, 0.06)">
      <RoundButton x={20} y={57} icon={ArrowLeftIcon} bg={bitkey.raised} />
      <Label x={20} y={138} size={38} letterSpacing={-0.9}>
        Settings
      </Label>
      <SectionLabel y={205}>GENERAL</SectionLabel>
      <SettingsRows
        y={225}
        rows={[
          { label: 'TRANSFERS', icon: <Glyph icon={ArrowRightLeftIcon} size={21} /> },
          { label: 'APPEARANCE', icon: <Glyph icon={PaletteIcon} size={21} /> },
          { label: 'NOTIFICATIONS', icon: <NotificationsGlyph /> },
          { label: 'MOBILE DEVICES', icon: <Glyph icon={SmartphoneIcon} size={21} /> },
          { label: 'INHERITANCE', icon: <Glyph icon={HandHeartIcon} size={21} /> },
        ]}
      />
      <SectionLabel y={550}>ADVANCED</SectionLabel>
      <SettingsRows
        y={570}
        rows={[
          { label: 'CUSTOM ELECTRUM SERVER', icon: <Glyph icon={LayersIcon} size={21} /> },
          { label: 'UTXO CONSOLIDATION', icon: <Glyph icon={FoldVerticalIcon} size={21} /> },
          { label: 'EXPORTS', icon: <Glyph icon={DownloadIcon} size={21} /> },
        ]}
      />
      <SectionLabel y={782}>SUPPORT</SectionLabel>
    </Screen>
  )
}

function ExportsScreen() {
  return (
    <Screen>
      <RoundButton x={20} y={74} icon={XIcon} bg={bitkey.raised} />
      <Box
        position="absolute"
        left={0}
        right={0}
        top="78px"
        textAlign="center"
        fontFamily={sans}
        fontSize="29px"
        lineHeight="36px"
        letterSpacing="-0.5px"
        color={bitkey.text}
      >
        Exports
      </Box>
      <ExportRow y={170} title="Transaction history" detail="Export CSV" />
      <Box position="absolute" left="20px" right="20px" top="239px" h="1px" bg="#D7D5D1" />
      <ExportRow y={248} title="Current wallet descriptor" detail="Export XPUB bundle" />
    </Screen>
  )
}

function ExportSheet() {
  return (
    <>
      <Box position="absolute" left="179px" top="12px" w="32px" h="4px" borderRadius="2px" bg={bitkey.grabber} />
      <Label x={20} y={48} size={30} letterSpacing={-0.6}>
        Export wallet descriptor
      </Label>
      <Label x={20} y={93} size={17} color={bitkey.secondary}>
        Download your Bitkey wallet descriptor.
      </Label>
      <Box
        position="absolute"
        left="20px"
        right="20px"
        top="131px"
        p="16px"
        borderRadius="12px"
        bg={bitkey.warningBackground}
        color={bitkey.warningText}
        fontFamily={sans}
        fontSize="17px"
        lineHeight="24px"
      >
        XPUB bundles contain sensitive privacy data. For tax reporting, use your transaction history.
      </Box>
      <Pill y={259} bg={bitkey.text} color={bitkey.raised}>
        DOWNLOAD XPUB BUNDLE
      </Pill>
    </>
  )
}

// ─── Bitkey pieces ──────────────────────────────────────────────────────────

function Screen({ children, ...props }: { children: ReactNode } & BoxProps) {
  return (
    <Box position="absolute" inset={0} bg={bitkey.background} {...props}>
      {children}
    </Box>
  )
}

function Label({
  x,
  y,
  size,
  weight = 400,
  font = 'sans',
  color = bitkey.text,
  letterSpacing = 0,
  children,
}: {
  x: number
  y: number
  size: number
  weight?: number
  font?: 'sans' | 'mono'
  color?: string
  letterSpacing?: number
  children: ReactNode
}) {
  const style: CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    margin: 0,
    whiteSpace: 'nowrap',
    fontFamily: font === 'mono' ? mono : sans,
    fontSize: size,
    lineHeight: `${Math.round(size * 1.25)}px`,
    fontWeight: weight,
    letterSpacing,
    color,
  }
  return <span style={style}>{children}</span>
}

function SectionLabel({ y, children }: { y: number; children: ReactNode }) {
  return (
    <Label x={20} y={y} size={14} font="mono" color={bitkey.secondary} letterSpacing={0.6}>
      {children}
    </Label>
  )
}

function SettingsRows({ y, rows }: { y: number; rows: Array<{ label: string; icon: ReactNode }> }) {
  return (
    <Box position="absolute" left="20px" right="20px" top={`${y}px`}>
      {rows.map(({ label, icon }) => (
        <Box
          key={label}
          h="57px"
          display="flex"
          alignItems="center"
          gap="14px"
          borderBottom={`1px solid ${bitkey.divider}`}
        >
          {icon}
          <Box flex={1} fontFamily={mono} fontSize="17px" letterSpacing="0.3px" color={bitkey.text}>
            {label}
          </Box>
          <Glyph icon={ChevronRightIcon} size={22} color={bitkey.chevron} />
        </Box>
      ))}
    </Box>
  )
}

function ExportRow({ y, title, detail }: { y: number; title: string; detail: string }) {
  return (
    <Box position="absolute" left="20px" right="20px" top={`${y}px`} h="62px" display="flex" alignItems="center">
      <Box flex={1} fontFamily={sans} color={bitkey.text}>
        <Box fontSize="17px" lineHeight="22px">
          {title}
        </Box>
        <Box fontSize="15px" lineHeight="22px" color={bitkey.secondary}>
          {detail}
        </Box>
      </Box>
      <Glyph icon={DownloadIcon} size={22} strokeWidth={1.75} />
    </Box>
  )
}

function RoundButton({ x, y, icon, bg }: { x: number; y: number; icon: LucideIcon; bg: string }) {
  return (
    <Box
      position="absolute"
      left={`${x}px`}
      top={`${y}px`}
      w="44px"
      h="44px"
      borderRadius="full"
      bg={bg}
      display="grid"
      placeItems="center"
    >
      <Glyph icon={icon} size={22} strokeWidth={2} />
    </Box>
  )
}

function Card({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: ReactNode }) {
  return (
    <Box
      position="absolute"
      left={`${x}px`}
      top={`${y}px`}
      w={`${w}px`}
      h={`${h}px`}
      borderRadius="10px"
      bg={bitkey.raised}
    >
      {children}
    </Box>
  )
}

function Pill({ y, bg, color, children }: { y: number; bg: string; color: string; children: ReactNode }) {
  return (
    <Box
      position="absolute"
      left="20px"
      right="20px"
      top={`${y}px`}
      h="56px"
      borderRadius="28px"
      bg={bg}
      color={color}
      display="grid"
      placeItems="center"
      fontFamily={mono}
      fontSize="16px"
      letterSpacing="0.8px"
    >
      {children}
    </Box>
  )
}

function Glyph({
  icon: Icon,
  size,
  strokeWidth = 1.75,
  color = bitkey.text,
}: {
  icon: LucideIcon
  size: number
  strokeWidth?: number
  color?: string
}) {
  return <Icon size={size} strokeWidth={strokeWidth} color={color} style={{ flexShrink: 0 }} />
}

/** Bitkey hides balances behind eight-spoked asterisks. */
function Asterisk({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <g stroke={bitkey.faint} strokeWidth={size < 20 ? 4 : 6} strokeLinecap="round">
        <path d="M20 3v34M3 20h34M8 8l24 24M32 8L8 32" />
      </g>
    </svg>
  )
}

/** Bitkey's notifications icon: a square with a dot on its corner. */
function NotificationsGlyph() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"
        stroke={bitkey.text}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="18.5" cy="5.5" r="2.75" fill={bitkey.text} />
    </svg>
  )
}
