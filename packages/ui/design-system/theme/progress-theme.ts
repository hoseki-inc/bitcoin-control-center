import { theme as chakraTheme, defineStyleConfig } from '@chakra-ui/react'

export const progressTheme = defineStyleConfig({
  ...chakraTheme.components.Progress,
  variants: {
    ...chakraTheme.components.Progress.variants,
    hoseki: {
      track: {
        bg: 'surface.muted',
      },
      filledTrack: {
        bg: 'linear-gradient(180deg, #FFF7A0 0%, #FFE56C 39%, #FFD54A 91.67%)',
      },
    },
  },
  defaultProps: {
    size: 'md',
    colorScheme: 'yellow',
    variant: 'hoseki',
  },
})
