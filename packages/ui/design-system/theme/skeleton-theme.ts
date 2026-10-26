import { cssVar, defineStyle, defineStyleConfig } from '@chakra-ui/react'

// Chakra's Skeleton reads these variables, unprefixed, for its pulse.
const $startColor = cssVar('skeleton-start-color')
const $endColor = cssVar('skeleton-end-color')

// A soft pulse between two light neutrals; the global reduced-motion rule holds it still.
export const skeletonTheme = defineStyleConfig({
  baseStyle: defineStyle({
    [$startColor.variable]: 'colors.neutral.100',
    [$endColor.variable]: 'colors.neutral.200',
    background: $startColor.reference,
    borderColor: $endColor.reference,
    opacity: 1,
    borderRadius: 'control',
  }),
})
