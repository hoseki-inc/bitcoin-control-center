import {
  Link as ChakraLink,
  type LinkProps as ChakraLinkProps,
  Flex,
  type FlexProps,
  forwardRef,
} from '@chakra-ui/react'
import { ChevronLeft } from 'lucide-react'

export type TopBarProps = FlexProps & {
  children: React.ReactNode
}

export function TopBar({ children, ...props }: TopBarProps): JSX.Element {
  return (
    <Flex justifyContent="space-between" align="center" flexWrap="wrap" gap={2} textStyle="text/sm" {...props}>
      {children}
    </Flex>
  )
}

TopBar.Item = forwardRef<ChakraLinkProps & { children: React.ReactNode }, 'div'>(function TopBarItem(
  { children, ...props },
  ref,
) {
  return (
    <ChakraLink
      ref={ref}
      display="inline-flex"
      alignItems="center"
      minH="44px"
      textUnderlineOffset="3px"
      fontWeight="medium"
      {...props}
    >
      {children}
    </ChakraLink>
  )
})

/** The page's way back: a chevron and label, quiet until hovered. Shared by every page so they match. */
TopBar.Back = forwardRef<ChakraLinkProps & { children: React.ReactNode }, 'a'>(function TopBarBack(
  { children, ...props },
  ref,
) {
  return (
    <ChakraLink
      ref={ref}
      display="inline-flex"
      alignItems="center"
      gap={1}
      minH="36px"
      px={2}
      ml={-2}
      borderRadius="full"
      color="text.primary"
      fontWeight="medium"
      textStyle="text/sm"
      transition="background-color 150ms ease"
      _hover={{ textDecoration: 'none', bg: 'surface.muted' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '2px' }}
      {...props}
    >
      <ChevronLeft size={16} aria-hidden />
      {children}
    </ChakraLink>
  )
})
