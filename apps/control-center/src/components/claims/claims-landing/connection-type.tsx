import { Flex, Stack, Text, chakra } from '@chakra-ui/react'
import { type ReactNode } from 'react'
import { Link } from 'react-router'

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
  return (
    <Stack
      as={Link}
      to={to}
      state={state}
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
      alignItems="center"
      direction="row"
      minW={0}
      minH="64px"
      transition="background-color 150ms ease, border-color 150ms ease"
      p={4}
      gap={4}
      _hover={{ cursor: 'pointer', bgColor: 'neutral.50' }}
    >
      <Flex
        aria-hidden="true"
        justifyContent="center"
        align="center"
        w={imagePath ? '96px' : '32px'}
        flexShrink={0}
        h="30px"
        overflow="hidden"
      >
        {imagePath ? <chakra.img src={imagePath} alt={imageAltText} maxW="96px" maxH="28px" /> : media}
      </Flex>
      <Text minW={0} overflowWrap="anywhere" textStyle="text/sm" fontWeight="medium">
        {title}
      </Text>
    </Stack>
  )
}
