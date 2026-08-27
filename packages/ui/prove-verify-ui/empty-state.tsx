import { Text, VStack } from '@chakra-ui/react'
import { type ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: ReactNode
  children?: ReactNode
}): JSX.Element {
  return (
    <VStack
      gap={0}
      textAlign="center"
      align="center"
      bg="linear-gradient(180deg, rgb(0 0 0 / 2.5%) 1.21%, #FFF 61.72%)"
      pt={16}
      pb={8}
      px={8}
      borderRadius="4px"
    >
      {icon}
      <VStack mt={8} gap={0}>
        <Text textStyle="text/lg" fontWeight="medium" color="neutral.900">
          {title}
        </Text>
        <Text textStyle="text/sm" fontWeight="regular" color="neutral.600">
          {description}
        </Text>
      </VStack>
      {children}
    </VStack>
  )
}
