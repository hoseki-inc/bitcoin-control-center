import { Box, type BoxProps, Stack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function GenericAccountTable({
  title,
  rows = [],
  ...boxProps
}: BoxProps & {
  title: string
  rows: {
    label: string
    value: ReactNode
  }[]
}): JSX.Element {
  return (
    <Box borderRadius="4px" border="1px solid" borderColor="neutral.200" {...boxProps}>
      <Text bgColor="neutral.200" p={2} textTransform="uppercase">
        {title}
      </Text>
      {rows.map(({ label, value }, index) => (
        <Stack
          key={index}
          direction={{ base: 'column', sm: 'row' }}
          gap={0}
          borderBottom="1px solid"
          borderColor="neutral.200"
        >
          <Text w={{ base: 'full', sm: '25%' }} p={2}>
            {label}
          </Text>
          <Box w={{ base: 'full', sm: '75%' }} minW={0} overflowWrap="anywhere" p={2}>
            {value}
          </Box>
        </Stack>
      ))}
    </Box>
  )
}
