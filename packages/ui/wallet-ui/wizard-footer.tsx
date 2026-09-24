import { Box, HStack } from '@chakra-ui/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Wrapper } from '../prove-verify-ui'

// Lucide's chevron-left, as used by TopBar.Back.
const CHEVRON_LEFT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>'

/**
 * Actions for a step-by-step flow, pinned to the bottom of the window above the dock.
 * No card: content scrolling underneath softens into a blurred fade, the way a sheet
 * toolbar does, and the back action is a quiet text button so the next step leads.
 */
export function WizardFooter({
  leftButton,
  rightButton,
}: {
  leftButton?: ReactNode
  rightButton?: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const pinned = usePinned(ref)
  return (
    <Box ref={ref} position="sticky" bottom="var(--sheet-footer-offset, 16px)" zIndex={10} mt={8}>
      <Box
        aria-hidden
        position="absolute"
        // Runs past the content column and down to the window's bottom edge, where the
        // sheet clips it, so the only visible edge is the soft fade at the top.
        insetX="-50vw"
        top={-10}
        bottom="-200px"
        pointerEvents="none"
        // Only while pinned over scrolling content; on a short page the footer simply
        // follows the content and a fade would end in a hard edge mid-window.
        opacity={pinned ? 1 : 0}
        transition="opacity 200ms ease"
        bg="var(--footer-fade)"
        sx={{
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          maskImage: 'linear-gradient(to bottom, transparent, black 60px)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 60px)',
        }}
      />
      <Wrapper maxW="928px" px={0} position="relative">
        <HStack
          justifyContent={Boolean(leftButton) ? 'space-between' : 'flex-end'}
          width="full"
          minH="44px"
          gap={3}
          flexWrap="wrap"
        >
          {Boolean(leftButton) ? (
            <Box
              sx={{
                // Back is secondary navigation: a text button with a leading chevron.
                '& .chakra-button': {
                  bg: 'transparent',
                  border: 'none',
                  boxShadow: 'none',
                  pl: 2,
                  color: 'text.primary',
                  _hover: { bg: 'surface.muted', color: 'text.primary' },
                },
                // The same chevron as TopBar.Back, drawn with a mask so it takes the text colour.
                '& .chakra-button::before': {
                  content: '""',
                  boxSize: '16px',
                  mr: 1,
                  bg: 'currentColor',
                  mask: `url("data:image/svg+xml,${encodeURIComponent(CHEVRON_LEFT)}") center / contain no-repeat`,
                  WebkitMask: `url("data:image/svg+xml,${encodeURIComponent(CHEVRON_LEFT)}") center / contain no-repeat`,
                },
              }}
            >
              {leftButton}
            </Box>
          ) : null}
          {rightButton}
        </HStack>
      </Wrapper>
    </Box>
  )
}

// The footer sits in the flow now, so pages no longer need to reserve room beneath their content.
/** True while the sticky footer is held at its offset, i.e. content continues beneath it. */
function usePinned(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    const footer = ref.current
    if (footer === null) {
      return
    }
    const scroller = footer.closest<HTMLElement>('#main-content') ?? document.scrollingElement
    if (scroller == null) {
      return
    }
    const update = (): void => {
      const offset = Number.parseFloat(getComputedStyle(footer).bottom) || 0
      const limit =
        scroller === document.scrollingElement ? window.innerHeight : scroller.getBoundingClientRect().bottom
      const canScroll = scroller.scrollHeight > scroller.clientHeight + 1
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
      setPinned(canScroll && !atEnd && footer.getBoundingClientRect().bottom >= limit - offset - 1)
    }
    update()
    const target: Element | Window = scroller === document.scrollingElement ? window : scroller
    target.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(scroller)
    if (scroller.firstElementChild) {
      observer?.observe(scroller.firstElementChild)
    }
    return () => {
      target.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [ref])
  return pinned
}

WizardFooter.padding = 0
