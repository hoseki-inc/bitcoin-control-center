import { Flex, Stack, chakra } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { PageHeading } from '../design-system/page-heading'

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
    <Stack gap={6} mb={6}>
      <Flex
        justifyContent="space-between"
        align={{ base: 'stretch', sm: 'center' }}
        direction={{ base: 'column', sm: 'row' }}
        gap={4}
      >
        <PageHeading title={title} description={description} flexGrow={1} />
        {rightContent}
      </Flex>
      {!hideDivider && <chakra.hr />}
    </Stack>
  )
}
