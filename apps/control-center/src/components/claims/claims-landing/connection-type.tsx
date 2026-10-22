import { Flex, Stack, Text, chakra } from '@chakra-ui/react'
import type { ReactNode } from 'react'
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
  state?: { returnTo?: string }
} & MediaProps): JSX.Element {
  return (
    <Stack
      as={Link}
      to={to}
      state={state}
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="4px"
      alignItems="center"
      // Two tiles share a phone's width, so they keep less padding there.
      p={{ base: 5, sm: 8 }}
      gap={{ base: 6, sm: 8 }}
      _hover={{ cursor: 'pointer', bgColor: 'neutral.50' }}
    >
      <Flex justifyContent="center" h="30px">
        {imagePath != null && imagePath !== '' ? <chakra.img src={imagePath} alt={imageAltText} maxW="100px" /> : media}
      </Flex>
      <Text textStyle="label/md" fontWeight="medium">
        {title}
      </Text>
    </Stack>
  )
}
