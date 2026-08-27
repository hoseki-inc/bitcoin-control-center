import {
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Alert as ChakraAlert,
  type AlertProps as ChakraAlertProps,
  Flex,
  Link,
  VStack,
} from '@chakra-ui/react'
import type { ReactNode } from 'react'

export interface AlertProps extends Omit<ChakraAlertProps, 'title' | 'status' | 'variant'> {
  title?: ReactNode
  status?: 'info' | 'success' | 'error' | 'warning'
  variant?: 'inline' | 'toast'
  onRetry?: () => void
}

export function Alert({
  title,
  children,
  status = 'info',
  variant = 'inline',
  onRetry,
  ...props
}: AlertProps): JSX.Element {
  const displayTitle = title ?? (status === 'error' ? 'Error' : undefined)

  return (
    <ChakraAlert status={status} {...props}>
      <Flex flex={1} alignItems="center">
        {variant === 'toast' && (
          <Box>
            <Flex display="inline-flex" alignItems="baseline" gap={0}>
              <AlertIcon mr={1} />
              <AlertTitle fontWeight="medium" mr={1} as="span">
                {displayTitle}
              </AlertTitle>
            </Flex>
            <AlertDescription as="span">{children}</AlertDescription>
          </Box>
        )}
        {variant !== 'toast' && (
          <VStack spacing={0} alignItems="flex-start">
            {displayTitle && (
              <Flex alignItems="center">
                <AlertIcon mr={1} />
                <AlertTitle>{displayTitle}</AlertTitle>
              </Flex>
            )}
            {children && <AlertDescription>{children}</AlertDescription>}
          </VStack>
        )}
      </Flex>
      {onRetry && (
        <Link onClick={onRetry} cursor="pointer" textDecoration="underline" textStyle="text/sm" fontWeight="medium">
          Retry
        </Link>
      )}
    </ChakraAlert>
  )
}
