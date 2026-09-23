import { Alert, type AlertProps, Box, HStack, Icon, Text } from '@chakra-ui/react'
import type { LucideIcon } from 'lucide-react'

export function TipAlert({
  title,
  icon,
  children,
  ...props
}: {
  title: string
  icon: LucideIcon
  children: React.ReactNode
} & AlertProps): JSX.Element {
  return (
    <Alert bgColor="surface.subtle" px={6} py={4} borderRadius="4px" textAlign="left" {...props}>
      <HStack gap={2} align="center" w="full">
        <Icon as={icon} boxSize={5} color="text.primary" flexShrink={0} />
        <Box color="text.primary" fontSize="sm" lineHeight="20px" textAlign="left">
          <Text fontWeight="medium">{title}</Text>
          {children}
        </Box>
      </HStack>
    </Alert>
  )
}
