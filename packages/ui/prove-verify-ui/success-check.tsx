// Lottie runs animation expressions with eval: only render bundled animations.
import Lottie from 'lottie-react'
import greenCheckCircle from './assets/lottie-animations/green-check-circle.json'

/** The green check that draws itself once when something succeeds. */
export function SuccessCheck({ size = '60px' }: { size?: string }): JSX.Element {
  return (
    <Lottie
      animationData={greenCheckCircle}
      loop={false}
      autoplay={true}
      style={{
        width: size,
        height: size,
        margin: '0 auto',
      }}
    />
  )
}
