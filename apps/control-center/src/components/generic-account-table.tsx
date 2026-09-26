import { Box, type BoxProps, HStack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function GenericAccountTable({
  title,
  rows,
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
        <HStack key={index} borderBottom="1px solid" borderColor="neutral.200">
          <Text w="25%" p={2}>
            {label}
          </Text>
          <Box w="75%" p={2}>
            {value}
          </Box>
        </HStack>
      ))}
    </Box>
  )
}
