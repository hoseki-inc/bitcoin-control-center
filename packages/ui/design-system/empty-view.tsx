import { Box, type StackProps, Text, VStack } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function EmptyView({
  title,
  description,
  action,
  ...props
}: { title: string; description?: string; action?: ReactNode } & StackProps): JSX.Element {
  return (
    <VStack gap={2} px={6} py={{ base: 10, md: 16 }} textAlign="center" align="center" {...props}>
      <Text as="h2" textStyle="text/xl" fontWeight="medium" color="neutral.900">
        {title}
      </Text>
      {description && (
        <Text textStyle="text/md" fontWeight="regular" color="neutral.600" maxW="46ch">
          {description}
        </Text>
      )}
      {action && <Box mt={3}>{action}</Box>}
    </VStack>
  )
}
