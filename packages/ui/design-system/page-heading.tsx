import { Box, type BoxProps, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function PageHeading({
  title,
  description,
  ...props
}: { title: string; description?: ReactNode } & BoxProps): JSX.Element {
  return (
    <Box minW={0} {...props}>
      <Text as="h1" textStyle="text/2xl" fontWeight="medium" color="neutral.900" overflowWrap="anywhere">
        {title}
      </Text>
      {Boolean(description) ? (
        <Text textStyle="text/md" color="neutral.600" mt={1} maxW="65ch">
          {description}
        </Text>
      ) : (
        description
      )}
    </Box>
  )
}
