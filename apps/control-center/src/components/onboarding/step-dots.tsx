import { Box, HStack } from '@chakra-ui/react'
import { motion } from '@hoseki/packages/ui/design-system/animations/motion'

const TRANSITION = `width ${motion.revealMs}ms ${motion.easeOut}, background-color ${motion.revealMs}ms ${motion.easeOut}`

/** Where the introduction is, with the current step stretched into a pill. Decorative; the step is announced separately. */
export function StepDots({ count, current }: { count: number; current: number }): JSX.Element {
  return (
    <HStack spacing={1.5} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <Box
          key={index}
          h={1.5}
          w={index === current ? 5 : 1.5}
          borderRadius="full"
          bg={index === current ? 'neutral.900' : 'neutral.300'}
          transition={TRANSITION}
        />
      ))}
    </HStack>
  )
}
