import { Box, type BoxProps, Link, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { Spinner } from '../design-system'

export function WaitingOnDevice({ message, ...rest }: { message: string } & BoxProps): JSX.Element {
  return (
    <Box textAlign="center" mb={-2} {...rest}>
      <Spinner size="sm" />
      <Text textStyle="text/sm" color="neutral.600">
        {message}
      </Text>
      <TimedoutRetry />
    </Box>
  )
}

export function TimedoutRetry(): JSX.Element | null {
  const [retryCopy, setRetryCopy] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setRetryCopy("If you're having trouble, reset this step by clicking here.")
    }, 20000)

    const timer2 = setTimeout(() => {
      setRetryCopy("This is taking longer than expected. If it's stuck, reset this step and try again.")
    }, 30000)

    return () => {
      clearTimeout(timer)
      clearTimeout(timer2)
    }
  }, [])

  function handleRetry() {
    window.location.reload()
  }

  return retryCopy ? (
    <Link as="button" textStyle="text/xs" color="primary.500" onClick={handleRetry}>
      {retryCopy}
    </Link>
  ) : null
}
