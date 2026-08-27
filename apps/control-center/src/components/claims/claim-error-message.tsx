import { Text } from '@chakra-ui/react'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { Link } from 'react-router'

export function ClaimErrorMessage({ error }: { error: unknown }): JSX.Element {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred'

  return (
    <ErrorBanner
      mb={4}
      message={message}
      rightContent={
        <Text as={Link} to="/accounts">
          Retry
        </Text>
      }
    />
  )
}
