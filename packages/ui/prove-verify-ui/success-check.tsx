// Lottie runs animation expressions with eval: only render bundled animations.
import Lottie from 'lottie-react'
// The same animation with its circle in neutral.500.
import grayCheckCircle from './assets/lottie-animations/gray-check-circle.json'
import greenCheckCircle from './assets/lottie-animations/green-check-circle.json'

/**
 * The check that draws itself once when something succeeds: green when it's verified, gray when it
 * worked but couldn't be verified.
 */
export function SuccessCheck({
  size = '60px',
  tone = 'success',
}: {
  size?: string
  tone?: 'success' | 'neutral'
}): JSX.Element {
  return (
    <Lottie
      animationData={tone === 'success' ? greenCheckCircle : grayCheckCircle}
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
