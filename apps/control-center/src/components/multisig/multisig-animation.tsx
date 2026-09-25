import { Box, usePrefersReducedMotion } from '@chakra-ui/react'
import Lottie from 'lottie-react'
import multisigAnimation2 from '../../assets/lottie-animations/multisig-2.json'
import multisigAnimation1 from '../../assets/lottie-animations/multisig.json'

export function MultisigAnimation({ animation }: { animation: '1' | '2' }): JSX.Element {
  const reducedMotion = usePrefersReducedMotion()
  if (reducedMotion) {
    return <></>
  }
  return (
    <Box mt={-4} mb={4}>
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
