import { Box, usePrefersReducedMotion } from '@chakra-ui/react'
// Lottie runs animation expressions with eval: only render bundled animations.
import Lottie from 'lottie-react'
import multisigAnimation2 from '../../assets/lottie-animations/multisig-2.json'
import multisigAnimation1 from '../../assets/lottie-animations/multisig.json'

export function MultisigAnimation({ animation }: { animation: '1' | '2' }): JSX.Element {
  const reducedMotion = usePrefersReducedMotion()
  if (reducedMotion) {
    return <></>
  }
  return (
    <Box
      mt={-4}
      mb={4}
      // Laptop-height windows keep the whole step, including its footer, on screen.
      sx={{
        '@media (max-height: 820px)': { '& > div': { width: '60% !important' } },
        '@media (max-height: 740px)': { '& > div': { width: '48% !important' } },
      }}
    >
      <Lottie
        animationData={animation === '1' ? multisigAnimation1 : multisigAnimation2}
        loop={true}
        autoplay={true}
        style={{
          width: '80%',
          margin: '0 auto',
        }}
      />
    </Box>
  )
}
