import { Box, type BoxProps } from '@chakra-ui/react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'

/** The viewport height left below the app header, for full-width pages that fill the screen. */
export const VIEWPORT_BELOW_HEADER = 'calc(100dvh - var(--app-header-height, 0px))'

export function Wrapper({ children, maxW = '863px', ...props }: { children: ReactNode } & BoxProps): JSX.Element {
  return (
    <Box maxW={maxW} mx="auto" px={{ base: 4, md: 6 }} {...props}>
      {children}
    </Box>
  )
}
export interface AppLayoutProps {
  header: ReactNode
  children: ReactNode
  fullWidth?: boolean
}

export function AppLayout({ header, children, fullWidth }: AppLayoutProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  // The header wraps on narrow screens, so measure it instead of hardcoding its height.
  useLayoutEffect(() => {
    const root = rootRef.current
    const headerElement = headerRef.current
    if (root === null || headerElement === null) {
      return
    }
    const update = (): void => {
      root.style.setProperty('--app-header-height', `${headerElement.offsetHeight}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(headerElement)
    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <Box ref={rootRef} pl="env(safe-area-inset-left)" pr="env(safe-area-inset-right)" pb="env(safe-area-inset-bottom)">
      <Box ref={headerRef}>{header}</Box>
      <Wrapper
        as="main"
        id="main-content"
        tabIndex={-1}
        pb={fullWidth === true ? 0 : { base: 8, md: 12 }}
        maxW={fullWidth === true ? '100%' : '928px'}
        px={fullWidth === true ? 0 : { base: 4, md: 6 }}
      >
        {children}
      </Wrapper>
    </Box>
  )
}
