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
      borderRadius="4px"
      alignItems="center"
      direction="column"
      justifyContent="center"
      minW={0}
      minH="144px"
      transition="background-color 150ms ease, border-color 150ms ease"
      p={{ base: 4, md: 6 }}
      gap={8}
      _focusVisible={{ outline: '2px solid', outlineColor: 'neutral.900', outlineOffset: '3px' }}
      _hover={{ cursor: 'pointer', bgColor: 'neutral.50' }}
    >
      <Flex aria-hidden="true" justifyContent="center" align="center" w="full" flexShrink={0} h="30px">
        {imagePath ? <chakra.img src={imagePath} alt={imageAltText} maxW="min(120px, 100%)" maxH="30px" /> : media}
      </Flex>
      <Text minW={0} textAlign="center" overflowWrap="anywhere" textStyle="text/sm" fontWeight="medium">
        {title}
      </Text>
    </Stack>
  )
}
