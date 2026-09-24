import { useColorMode } from '@chakra-ui/react'
import { useMemo } from 'react'
import { hasRasterFrames, withoutWhiteBackdrops } from './lottie-backdrop'

/**
 * The animation to play for the current appearance. In dark mode vector animations lose
 * their white backdrops; raster ones cannot, so `needsLightStage` asks for a light card.
 */
export function useThemedLottie<T extends object>(animation: T): { animationData: T; needsLightStage: boolean } {
  const { colorMode } = useColorMode()
  const dark = colorMode === 'dark'
  return useMemo(() => {
    const raster = hasRasterFrames(animation)
    if (!dark || raster) {
      return { animationData: animation, needsLightStage: dark && raster }
    }
    return { animationData: withoutWhiteBackdrops(animation), needsLightStage: false }
  }, [animation, dark])
}
