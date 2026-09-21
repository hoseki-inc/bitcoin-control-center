import { Box, HStack, Stack, Text, chakra } from '@chakra-ui/react'
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
      <HStack justifyContent="space-between">
        <Box flexGrow={1}>
          <Text as="h1" textStyle="text/md" color="neutral.900" fontWeight="medium">
            {title}
          </Text>
          {description && (
            <Text textStyle="text/sm" color="neutral.600">
              {description}
            </Text>
          )}
        </Box>
        {rightContent}
      </HStack>
      {!hideDivider && <chakra.hr />}
    </Stack>
  )
}
