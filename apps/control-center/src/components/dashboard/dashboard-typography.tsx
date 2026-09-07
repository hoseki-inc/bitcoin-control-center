import { Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function DashboardCardTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Text as="h2" textStyle="text/md" fontWeight="medium" color="neutral.900">
      {children}
    </Text>
  )
}

export function DashboardAmount({
  children,
  primary = false,
}: {
  children: ReactNode
  primary?: boolean
}): JSX.Element {
  return (
    <Text
      textStyle={primary ? { base: 'amount/compact', md: 'amount/primary' } : 'text/2xl'}
      fontFamily="body"
      fontWeight="medium"
      color="neutral.900"
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {children}
    </Text>
  )
}
