import { HStack } from '@chakra-ui/react'
import { DashedCircleFilledIcon } from '@hoseki/packages/ui/prove-verify-ui'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui/claims/keystore-avatar'
import { GradientAnimatedRing, keyIcon } from '@hoseki/packages/ui/prove-verify-ui/claims/keystores-status-indicator'
import { PlusCircleIcon } from '@hoseki/packages/ui/prove-verify-ui/icons/plus-circle'
import { useEffect, useState } from 'react'

type AnimationStage = 'fadeIn' | 'fullOpacity' | 'highlightRequired' | 'activeRequired'

interface AnimatedDetectedKeystoreAvatarsProps {
  totalKeystores: number
  threshold: number
}

export function AnimatedDetectedKeystoreAvatars({
  totalKeystores,
  threshold,
}: AnimatedDetectedKeystoreAvatarsProps): JSX.Element {
  const [currentStage, setCurrentStage] = useState<AnimationStage>('fadeIn')

  useEffect(() => {
    const stages: AnimationStage[] = ['fadeIn', 'fullOpacity', 'highlightRequired', 'activeRequired']
    let currentStageIndex = 0

    const advanceStage = () => {
      if (currentStageIndex < stages.length - 1) {
        currentStageIndex++
        const nextStage = stages[currentStageIndex]
        if (nextStage) {
          setCurrentStage(nextStage)
          if (currentStageIndex < stages.length - 1) {
            setTimeout(advanceStage, 2500) // Wait 1500ms before next stage
          }
        }
      }
    }

    // Start the sequence after initial render
    const initialTimeout = setTimeout(advanceStage, 1500)

    return () => {
      clearTimeout(initialTimeout)
    }
  }, [totalKeystores, threshold])

  // Generate keystore data for visualization
  const keystores = Array.from({ length: totalKeystores }, (_, index) => ({
    id: `keystore-${index}`,
    name: `Key ${index + 1}`,
    isRequired: index < threshold,
  }))

  const getKeystoreOpacity = (index: number): number => {
    switch (currentStage) {
      case 'fadeIn':
        return 0
      case 'fullOpacity':
        return 1.0 // All keys at full opacity
      case 'highlightRequired': // These two stages are the same
      case 'activeRequired':
        return index < threshold ? 1.0 : 0.3
      default:
        return 1.0
    }
  }

  const getKeystoreTransitionDelay = (index: number): string => {
    // Only add delay during the fadeIn to fullOpacity transition
    if (currentStage === 'fullOpacity') {
      return `${index * 200}ms`
    }
    return '0ms'
  }

  const checkIsKeystoreRingVisible = (index: number): boolean => {
    return ['activeRequired', 'highlightRequired'].includes(currentStage) && index < threshold
  }

  const commonProps = { boxSize: '16px' } as const
  return (
    <HStack gap={4} justifyContent="center">
      {keystores.map((keystore, index) => (
        <GradientAnimatedRing
          isEnabled={true}
          color="yellow"
          key={keystore.id}
          opacity={getKeystoreOpacity(index)}
          transform={currentStage === 'fadeIn' ? 'translateY(8px)' : 'translateY(0)'}
          transition="opacity 500ms ease-in-out, transform 500ms ease-in-out"
          transitionDelay={getKeystoreTransitionDelay(index)}
          position="relative"
          ringProps={{
            opacity: checkIsKeystoreRingVisible(index) ? 1 : 0,
            transition: 'opacity 500ms ease-in-out',
          }}
        >
          <KeystoreAvatar icon={keyIcon} variant="filled" position="relative" zIndex={1}>
            <KeystoreAvatar.Badge>
              {index < threshold ? (
                <PlusCircleIcon
                  {...commonProps}
                  stroke="shades.0"
                  strokeWidth="2"
                  fill="neutral.100"
                  color="shades.100"
                />
              ) : (
                <DashedCircleFilledIcon {...commonProps} />
              )}
            </KeystoreAvatar.Badge>
          </KeystoreAvatar>
        </GradientAnimatedRing>
      ))}
    </HStack>
  )
}
