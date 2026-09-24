import { Box, IconButton } from '@chakra-ui/react'
import { curves, durations } from '@hoseki/packages/ui/design-system/animations/motion'
import { motion, useIsPresent } from 'framer-motion'
import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate, useOutlet } from 'react-router'
import { sectionForPath } from './sections'

const MotionBox = motion.create(Box)

/** Room left at the bottom of a sheet so content can scroll clear of the dock. */
export const DOCK_CLEARANCE = '104px'

const SHEET_HEIGHT = { base: 'calc(100dvh - 2vh)', md: 'calc(100dvh - 32px)', lg: 'calc(100dvh - 60px)' }

/** Keeps showing the page that was open while the sheet animates away. */
function PresentOutlet(): ReactNode {
  const outlet = useOutlet()
  const isPresent = useIsPresent()
  const last = useRef(outlet)
  if (isPresent) {
    last.current = outlet
  }
  return last.current
}

function modalOrWelcomeIsOpen(): boolean {
  return (
    document.querySelector('[role="dialog"][aria-modal="true"], .chakra-modal__content-container') !== null ||
    document.querySelector('[data-welcome-phase]:not([data-welcome-phase="done"])') !== null
  )
}

/**
 * The window every page opens in. It grows out of the dock, paints a cached, blurred copy
 * of the wallpaper instead of blurring live content, and stays mounted while you move
 * between sections so only the contents change.
 */
export function Sheet({ wallpaperSnapshot }: { wallpaperSnapshot: string | null }): JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isPresent = useIsPresent()
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const current = sectionForPath(pathname)
  // Freeze the section while exiting too, or the page would remount blank mid-animation.
  const sectionRef = useRef(current)
  if (isPresent) {
    sectionRef.current = current
  }
  const section = sectionRef.current
  const pageKey = useRef(pathname)
  if (isPresent && current?.id !== undefined) {
    pageKey.current = current.id
  }

  useEffect(() => {
    if (!isPresent) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || modalOrWelcomeIsOpen()) {
        return
      }
      void navigate('/home')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isPresent, navigate])

  // Each route starts at the top, and focus moves to it so screen readers hear the change.
  useEffect(() => {
    if (!isPresent) {
      return
    }
    const scroller = scrollerRef.current
    if (scroller === null) {
      return
    }
    scroller.scrollTop = 0
    scroller.focus({ preventScroll: true })
  }, [pathname, isPresent])

  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={20}
      display="flex"
      alignItems="flex-end"
      justifyContent="center"
      pointerEvents="none"
    >
      <MotionBox
        position="relative"
        w={{ base: '100%', md: 'calc(100vw - 50px)', lg: 'calc(100vw - 120px)' }}
        maxW="1320px"
        h={SHEET_HEIGHT}
        borderTopRadius="var(--radius-window)"
        // clip, not hidden: a hidden box can still be scrolled by focus and scrollIntoView,
        // which would slide the oversized wallpaper layer (and the whole window) out of place.
        overflow="clip"
        boxShadow="var(--window-shadow)"
        pointerEvents="auto"
        style={{ transformOrigin: '50% 100%' }}
        initial={{ opacity: 0, y: 28, scale: 0.94 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          transition: {
            duration: durations.sheetIn / 1000,
            ease: curves.enter,
            // Opaque by 45% of the way, so the sheet reads as solid while it settles.
            opacity: { duration: (durations.sheetIn / 1000) * 0.45, ease: 'linear' },
          },
        }}
        exit={{
          opacity: 0,
          y: 20,
          scale: 0.96,
          transition: {
            duration: durations.sheetOut / 1000,
            ease: curves.exit,
            // Hold opacity for the first 30% so the sheet visibly sinks before it dissolves.
            opacity: { duration: (durations.sheetOut / 1000) * 0.7, delay: (durations.sheetOut / 1000) * 0.3 },
          },
        }}
      >
        {wallpaperSnapshot !== null && (
          <Box
            as="img"
            src={wallpaperSnapshot}
            alt=""
            aria-hidden
            position="absolute"
            inset={0}
            w="100%"
            h="100%"
            objectFit="cover"
            transform="scale(1.2)"
            filter="var(--window-wallpaper-filter)"
            sx={{
              animation: `sheetWallpaperIn ${durations.wallpaperReveal}ms ease-out 200ms both`,
              '@keyframes sheetWallpaperIn': { from: { opacity: 0 }, to: { opacity: 1 } },
            }}
          />
        )}
        <Box aria-hidden position="absolute" inset={0} layerStyle="window" borderRadius={0} />

        <Box
          as="main"
          id="main-content"
          tabIndex={-1}
          ref={scrollerRef}
          position="relative"
          h="100%"
          overflowY="auto"
          overscrollBehavior="contain"
          outline="none"
          pb={DOCK_CLEARANCE}
          aria-label={section?.label}
          sx={{
            // Pages that fill the viewport measure against the sheet instead of the window.
            '--shell-viewport-height': SHEET_HEIGHT.base,
            '@media (min-width: 48em)': { '--shell-viewport-height': SHEET_HEIGHT.md },
            '@media (min-width: 62em)': { '--shell-viewport-height': SHEET_HEIGHT.lg },
            '--sheet-footer-offset': '94px',
          }}
        >
          <MotionBox
            key={pageKey.current}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.15, ease: 'easeOut' } }}
          >
            <PresentOutlet />
          </MotionBox>
        </Box>

        <Box aria-hidden position="absolute" inset={0} layerStyle="windowChrome" zIndex={2} />
        <IconButton
          aria-label="Close"
          icon={<X size={16} strokeWidth={2.5} />}
          onClick={() => {
            void navigate('/home')
          }}
          position="absolute"
          top={{ base: 3, lg: 5 }}
          right={{ base: 3, lg: 5 }}
          zIndex={3}
          size="sm"
          minW="32px"
          h="32px"
          borderRadius="full"
          variant="ghost"
          bg="surface.muted"
          color="text.secondary"
          _hover={{ bg: 'surface.emphasis', color: 'text.primary' }}
          _active={{ transform: 'scale(0.92)' }}
        />
      </MotionBox>
    </Box>
  )
}

/** Width wrapper for pages inside a sheet. Full-width pages manage their own layout. */
export function SheetPage({ fullWidth = false }: { fullWidth?: boolean }): JSX.Element {
  return (
    <Box
      maxW={fullWidth ? '100%' : '928px'}
      mx="auto"
      px={fullWidth ? 0 : { base: 4, md: 6 }}
      pt={fullWidth ? { base: 12, lg: 0 } : { base: 12, lg: 4 }}
    >
      <Outlet />
    </Box>
  )
}
