import { Text, chakra } from '@chakra-ui/react'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { Link } from 'react-router'

export type ClaimError = { readonly message: string }

export function ClaimErrorMessage({ error, onRetry }: { error: ClaimError; onRetry?: () => void }): JSX.Element {
  const trimmed = error.message.trim()
  const message = trimmed !== '' ? trimmed : 'An unexpected error occurred'

  return (
    <ErrorBanner
      mb={4}
      w="full"
      message={message}
      rightContent={
        onRetry ? (
          <chakra.button
            type="button"
            textStyle="text/sm"
            fontWeight="semibold"
            flexShrink={0}
            cursor="pointer"
            _hover={{ textDecoration: 'underline' }}
            onClick={onRetry}
          >
            Retry
          </chakra.button>
        ) : (
          <Text as={Link} to="/accounts" textStyle="text/sm" fontWeight="semibold" flexShrink={0}>
            Retry
          </Text>
        )
      }
    />
  )
}
