import { Box, HStack, Heading } from '@chakra-ui/react'

export function Promotion({
  title,
  content,
  imagePath,
  imageAlt,
}: {
  title: string
  content: React.ReactNode
  imagePath: string
  imageAlt: string
}): JSX.Element {
  return (
    <HStack align="flex-start" border="2px solid" borderColor="gray.200" borderRadius={8} p={4} mb={8}>
      <Box flexGrow={1}>
        <Heading size="md" mb={4}>
          {title}
        </Heading>
        {content}
      </Box>
      <Box>
        <img src={imagePath} alt={imageAlt} width="250px" />
      </Box>
    </HStack>
  )
}
