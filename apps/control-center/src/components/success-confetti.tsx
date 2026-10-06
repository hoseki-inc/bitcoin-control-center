import { usePrefersReducedMotion } from '@chakra-ui/react'
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks'

/** Celebrates a finished connection or verification, unless the viewer prefers reduced motion. */
export function SuccessConfetti(): JSX.Element {
  // Read the media query on the first render so the canvas never mounts for reduced-motion viewers.
  const reducedMotion = usePrefersReducedMotion({ ssr: false })
  if (reducedMotion) {
    return <></>
  }
  return <Fireworks autorun={{ speed: 2, duration: 5_000, delay: 500 }} />
}
