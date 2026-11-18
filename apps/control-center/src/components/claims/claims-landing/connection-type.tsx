import { Flex, Stack, Text, chakra } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

type MediaProps = { imagePath: string; media?: never } | { media: ReactNode; imagePath?: never }

export function ConnectionType({
  title,
  imagePath,
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
      p={8}
      gap={8}
      _hover={{ cursor: 'pointer', bgColor: 'neutral.50' }}
    >
      {/* The logo repeats the title, so the title alone names the link. */}
      <Flex justifyContent="center" h="30px" aria-hidden>
        {imagePath != null && imagePath !== '' ? <chakra.img src={imagePath} alt="" maxW="100px" /> : media}
      </Flex>
      <Text textStyle="label/md" fontWeight="medium" textAlign="center" whiteSpace="pre-line">
        {title}
      </Text>
    </Stack>
  )
}
