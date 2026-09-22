import { HStack, Link } from '@chakra-ui/react'
import { HardwareDeviceError } from '../../wallet'
import { ErrorBanner, type ErrorBannerProps, type ErrorVariant } from '../design-system'
import { RestartIcon } from '../prove-verify-ui'

export type HardwareWalletErrorProps = {
  error: Error | HardwareDeviceError | { message: string }
  onRetry?: () => void
  variant?: ErrorVariant
} & Omit<ErrorBannerProps, 'message' | 'variant' | 'rightContent'>

export function HardwareWalletError({
  error,
  onRetry,
  variant = 'error',
  ...rest
}: HardwareWalletErrorProps): JSX.Element {
  const errorMessage = error instanceof HardwareDeviceError ? error.friendlyMessage : `Unknown error: ${error.message}`

  return (
    <ErrorBanner
      message={errorMessage}
      variant={variant}
      rightContent={
        onRetry && (
          <HStack py={3}>
            <Link as="button" fontWeight="semibold" onClick={onRetry}>
              Retry
            </Link>
            <RestartIcon strokeWidth={3} />
          </HStack>
        )
      }
      {...rest}
    />
  )
}
