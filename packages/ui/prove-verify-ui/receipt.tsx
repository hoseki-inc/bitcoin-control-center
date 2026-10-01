import { Box, Button, Flex, Stack, type StackProps, chakra } from '@chakra-ui/react'
// Lottie evaluates expressions in animation data with eval: render only bundled assets, never user-supplied JSON.
import Lottie from 'lottie-react'
import { XIcon } from 'lucide-react'
import { Spinner } from '../design-system'
import { Animations } from '../design-system/animations/animations'
import greenCheckCircle from './assets/lottie-animations/green-check-circle.json'

export function Receipt({
  title,
  state,
  closeTitle = 'Close',
  onClose,
  content,
  ...props
}: {
  title: string
  state: 'loading' | 'success'
  onClose?: () => void
  closeTitle?: string
  content?: React.ReactNode
} & Omit<StackProps, 'content'>): JSX.Element {
  return (
    <Stack alignItems="center" justify="center" pt={16} spacing={4} px="40px" position="relative" {...props}>
      {onClose && (
        <Button
          variant="ghost"
          position="absolute"
          top={4}
          left={4}
          title={closeTitle}
          _hover={{ bgColor: 'neutral.100' }}
          onClick={onClose}
          p={4}
        >
          <XIcon size={24} />
        </Button>
      )}

      <chakra.h1 textStyle="text/8xl" fontWeight="medium" textTransform="capitalize">
        {title}
      </chakra.h1>

      {state === 'loading' ? (
        <Flex sx={Animations.fadeIn(0.1)} h="68px" w="68px" alignItems="center" justifyContent="center">
          <Spinner size="xl" />
        </Flex>
      ) : (
        <Box>
          <Lottie
            animationData={greenCheckCircle}
            loop={false}
            autoplay={true}
            style={{
              width: '60px',
              height: '60px',
              margin: '0 auto',
            }}
          />
        </Box>
      )}

      <Box maxW={['100%', '100%', '70%']}>{content}</Box>
    </Stack>
  )
}
