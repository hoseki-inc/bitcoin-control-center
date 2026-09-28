import { Box, Flex, Stack, Text, chakra } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function SectionTitle({
  title,
  description,
  rightContent,
  hideDivider = false,
}: {
  title: string
  description?: ReactNode
  rightContent?: ReactNode
  hideDivider?: boolean
}): JSX.Element {
  return (
    <Stack gap={4} mb={4}>
      <Flex
        justifyContent="space-between"
        align={{ base: 'stretch', sm: 'center' }}
        direction={{ base: 'column', sm: 'row' }}
        gap={4}
      >
        <Box flexGrow={1} minW={0}>
          <Text as="h1" textStyle="text/md" color="neutral.900" fontWeight="medium">
            {title}
          </Text>
          {Boolean(description) ? (
            <Text textStyle="text/sm" color="neutral.600">
              {description}
            </Text>
          ) : (
            description
          )}
        </Box>
        {rightContent}
      </Flex>
      {!hideDivider && <chakra.hr />}
    </Stack>
  )
}
