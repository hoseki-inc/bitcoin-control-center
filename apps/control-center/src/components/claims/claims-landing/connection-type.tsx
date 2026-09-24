import { Flex, Stack, Text, chakra, useColorMode } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { logoForMode } from '../../../utils/themed-logo'

type MediaProps =
  | {
      imagePath: string
      imageAltText: string
      media?: never
    }
  | {
      media: ReactNode
      imagePath?: never
      imageAltText?: never
    }

export function ConnectionType({
  title,
  imagePath,
  imageAltText,
  media,
  to,
  state,
}: {
  title: string
  to: string
  state?: Record<string, unknown>
} & MediaProps): JSX.Element {
  const { colorMode } = useColorMode()
  const logo = imagePath === undefined ? undefined : logoForMode(imagePath, colorMode === 'dark' ? 'dark' : 'light')
  return (
    <Stack
      as={Link}
      to={to}
      state={state}
      layerStyle="edge"
      borderRadius="panel"
      alignItems="center"
      direction="column"
      justifyContent="center"
      minW={0}
      minH="144px"
      transition="background-color 150ms ease, border-color 150ms ease"
      p={{ base: 4, md: 6 }}
      gap={8}
      _focusVisible={{ outline: '2px solid', outlineColor: 'border.inverse', outlineOffset: '3px' }}
      _hover={{ cursor: 'pointer', bg: 'var(--edge-bg-hover)' }}
    >
      <Flex aria-hidden="true" justifyContent="center" align="center" w="full" flexShrink={0} h="30px">
        {logo ? (
          <chakra.img src={logo.src} alt={imageAltText} maxW="min(120px, 100%)" maxH="30px" filter={logo.filter} />
        ) : (
          media
        )}
      </Flex>
      <Text minW={0} textAlign="center" overflowWrap="anywhere" textStyle="text/sm" fontWeight="medium">
        {title}
      </Text>
    </Stack>
  )
}
