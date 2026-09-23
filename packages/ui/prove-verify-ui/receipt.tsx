import { Box, Button, Flex, Stack, type StackProps, chakra } from '@chakra-ui/react'
import { XIcon } from 'lucide-react'
import { Spinner } from '../design-system'
import { Animations } from '../design-system/animations/animations'
import { CheckCircleFilledIcon } from './icons'

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
    <Stack
      alignItems="center"
      justify="center"
      pt={{ base: 20, md: 24 }}
      pb={8}
      spacing={5}
      px={{ base: 4, md: 10 }}
      position="relative"
      {...props}
    >
      {onClose && (
        <Button
          variant="ghost"
          position="absolute"
          top={4}
          left={4}
          aria-label={closeTitle}
          _hover={{ bgColor: 'surface.muted' }}
          onClick={onClose}
          p={4}
        >
          <XIcon size={24} />
        </Button>
      )}

      <chakra.h1
        textStyle={{ base: 'text/2xl', md: 'text/4xl' }}
        fontWeight="medium"
        textAlign="center"
        overflowWrap="anywhere"
      >
        {title}
      </chakra.h1>

      {state === 'loading' ? (
        <Flex sx={Animations.fadeIn(0.1)} h="68px" w="68px" alignItems="center" justifyContent="center">
          <Spinner size="xl" />
        </Flex>
      ) : (
        <CheckCircleFilledIcon boxSize={12} color="status.success.fg" color2="text.inverse" aria-hidden="true" />
      )}

      <Box w="full" maxW="640px">
        {content}
      </Box>
    </Stack>
  )
}
