import { Spinner as ChakraSpinner, Flex, type SpinnerProps } from '@chakra-ui/react'
import { useDelayedFlag } from './loading/use-delayed-flag'

export function Spinner({
  fullPage,
  centered,
  isLazy = false,
  ...props
}: { fullPage?: boolean; centered?: boolean; isLazy?: boolean } & SpinnerProps): JSX.Element {
  const lazyShown = useDelayedFlag(isLazy, 200)
  const showSpinner = !isLazy || lazyShown

  const spinner = <ChakraSpinner visibility={showSpinner ? 'visible' : 'hidden'} {...props} />

  if (fullPage === true) {
    return (
      <Flex
        position="fixed"
        top={0}
        left={0}
        right={0}
        bottom={0}
        justifyContent="center"
        alignItems="center"
        pointerEvents="none"
        zIndex={9999}
      >
        {spinner}
      </Flex>
    )
  }

  if (centered === true) {
    return (
      <Flex w="full" justifyContent="center" py={8}>
        {spinner}
      </Flex>
    )
  }

  return spinner
}
