import { type StackProps, Text, VStack } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function EmptyView({
  icon,
  title,
  description,
  ...props
}: { icon: ReactNode; title: string; description?: string } & StackProps): JSX.Element {
  return (
    <VStack gap={0} textAlign="center" align="center" color="neutral.500" {...props}>
      {icon}
      <Text mt={2} textStyle="text/sm" fontWeight="medium">
        {title}
      </Text>
      {description && (
        <Text textStyle="text/sm" fontWeight="regular">
          {description}
        </Text>
      )}
    </VStack>
  )
}
