import { HStack, Link } from '@chakra-ui/react'
import { HardwareDeviceError } from '../../wallet'
import { ErrorBanner, type ErrorBannerProps, type ErrorVariant } from '../design-system'
import { RestartIcon } from '../prove-verify-ui'

export type HardwareWalletErrorProps = {
  error: Error | HardwareDeviceError | { message: string } | string
  onRetry?: () => void
  variant?: ErrorVariant
} & Omit<ErrorBannerProps, 'message' | 'variant' | 'rightContent'>

function isErrorMessage(error: HardwareWalletErrorProps['error']): error is string {
  return typeof error === 'string'
}

function hardwareWalletErrorMessage(error: HardwareWalletErrorProps['error']): string {
  if (isErrorMessage(error)) {
    return error
  }
  if (error instanceof HardwareDeviceError) {
    return error.friendlyMessage
  }
  return `Unknown error: ${error.message}`
}

export function HardwareWalletError({
  error,
  onRetry,
  variant = 'error',
  ...rest
}: HardwareWalletErrorProps): JSX.Element {
  const errorMessage = hardwareWalletErrorMessage(error)

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
