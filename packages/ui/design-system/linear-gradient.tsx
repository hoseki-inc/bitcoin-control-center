import { Flex, type FlexProps } from '@chakra-ui/react'

export interface LinearGradientProps extends FlexProps {
  gradientDirection: 'from-left' | 'from-right' | 'from-top' | 'from-bottom'
  gradientSize?: number
  gradientPercentage?: number
  baseColor?: string
}

export const LinearGradient = ({
  gradientDirection,
  gradientSize = 30,
  gradientPercentage = 90,
  baseColor = '#FFF',
  ...flexProps
}: LinearGradientProps): JSX.Element => {
  const gradientStyles = {
    'from-left': {
      top: 0,
      left: 0,
      width: `${gradientSize}%`,
      height: '100%',
      bgGradient: `linear(to left, rgba(255, 255, 255, 0) 0%, ${baseColor} ${gradientPercentage}%)`,
    },
    'from-right': {
      top: 0,
      right: 0,
      width: `${gradientSize}%`,
      height: '100%',
      bgGradient: `linear(to right, rgba(255, 255, 255, 0) 0%, ${baseColor} ${gradientPercentage}%)`,
    },
    'from-top': {
      top: 0,
      left: 0,
      width: '100%',
      height: `${gradientSize}%`,
      bgGradient: `linear(to top, rgba(255, 255, 255, 0) 0%, ${baseColor} ${gradientPercentage}%)`,
    },
    'from-bottom': {
      bottom: 0,
      left: 0,
      width: '100%',
      height: `${gradientSize}%`,
      bgGradient: `linear(to bottom, rgba(255, 255, 255, 0) 0%, ${baseColor} ${gradientPercentage}%)`,
    },
  }

  return <Flex position="absolute" pointerEvents="none" {...gradientStyles[gradientDirection]} {...flexProps} />
}
