import { HStack } from '@chakra-ui/react'
import { DashedCircleFilledIcon } from '@hoseki/packages/ui/prove-verify-ui'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui/claims/keystore-avatar'
import { GradientAnimatedRing, keyIcon } from '@hoseki/packages/ui/prove-verify-ui/claims/keystores-status-indicator'
import { PlusCircleIcon } from '@hoseki/packages/ui/prove-verify-ui/icons/plus-circle'

interface AnimatedDetectedKeystoreAvatarsProps {
  totalKeystores: number
  threshold: number
}

export function AnimatedDetectedKeystoreAvatars({
  totalKeystores,
  threshold,
}: AnimatedDetectedKeystoreAvatarsProps): JSX.Element {
  // Generate keystore data for visualization
  const keystores = Array.from({ length: totalKeystores }, (_, index) => ({
    id: `keystore-${index}`,
    name: `Key ${index + 1}`,
    isRequired: index < threshold,
  }))

  const commonProps = { boxSize: '16px' } as const
  return (
    <HStack gap={4} justifyContent="center">
      {keystores.map((keystore, index) => (
        <GradientAnimatedRing
          isEnabled={true}
          color="yellow"
          key={keystore.id}
          opacity={index < threshold ? 1 : 0.4}
          transition="opacity 180ms ease"
          position="relative"
          ringProps={{
            opacity: index < threshold ? 1 : 0,
            transition: 'opacity 180ms ease',
          }}
        >
          <KeystoreAvatar icon={keyIcon} variant="filled" position="relative" zIndex={1}>
            <KeystoreAvatar.Badge>
              {index < threshold ? (
                <PlusCircleIcon
                  {...commonProps}
                  stroke="text.inverse"
                  strokeWidth="2"
                  fill="surface.muted"
                  color="text.primary"
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
