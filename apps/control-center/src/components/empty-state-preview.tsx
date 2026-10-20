import { Box, type BoxProps, Image, Text } from '@chakra-ui/react'

/**
 * A faded picture of what appears once there is data, with its caption as text. Every preview
 * shares one width, so captions match and the pictures stay sharp on high-density screens.
 */
export function EmptyStatePreview({
  src,
  caption,
  ...props
}: BoxProps & { src: string; caption: string }): JSX.Element {
  return (
    <Box w="full" maxW="400px" mx="auto" textAlign="center" {...props}>
      <Image src={src} alt="" w="full" />
      <Text mt={3} textStyle="text/sm" color="neutral.500">
        {caption}
      </Text>
    </Box>
  )
}
