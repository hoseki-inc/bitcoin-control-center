import { Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function DashboardCardTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Text as="h2" textStyle="text/md" fontWeight="medium" color="neutral.900">
      {children}
    </Text>
  )
}

export function DashboardAmount({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Text
      textStyle={{ base: 'amount/compact', md: 'amount/primary' }}
      overflowWrap="anywhere"
      minW={0}
      fontFamily="body"
      fontWeight="medium"
      color="neutral.900"
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {children}
    </Text>
  )
}
