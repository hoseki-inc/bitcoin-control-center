import {
  Link as ChakraLink,
  type LinkProps as ChakraLinkProps,
  Flex,
  type FlexProps,
  forwardRef,
} from '@chakra-ui/react'

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
