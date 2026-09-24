import { HStack, Icon, Stack, Text } from '@chakra-ui/react'
import { CircleXIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function GenericError({
  title = 'An error occurred',
  message,
  children,
}: {
  title?: string
  message: string
  children?: ReactNode
}): JSX.Element {
  return (
    <Stack align="center" gap={6} py={16}>
      <HStack>
        <Icon as={CircleXIcon} color="status.error.fg" height="20px" width="20px" />
        <Text textStyle="text/lg" fontWeight="medium" color="text.primary">
          {title}
        </Text>
      </HStack>
      <Text textStyle="text/md" color="text.primary">
        {message}
      </Text>
      {children}
    </Stack>
  )
}
