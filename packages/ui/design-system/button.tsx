import { type ButtonProps, Button as ChakraButton, Icon, useBreakpointValue } from '@chakra-ui/react'
import { getRecordValue } from '@hoseki/packages/lib'

const iconSizeMap = {
  sm: '14px',
  md: '16px',
  lg: '18px',
} satisfies Record<string, string>

function isResponsiveSize(size: ButtonProps['size']): size is Exclude<ButtonProps['size'], string | undefined> {
  return typeof size === 'object'
}

export function Button({ leftIcon, rightIcon, ...props }: ButtonProps): JSX.Element {
  const breakpointSize = useBreakpointValue(isResponsiveSize(props.size) ? props.size : { base: props.size })
  const resolvedSize = breakpointSize != null && breakpointSize !== '' ? breakpointSize : 'md'

  const iconSize = getRecordValue(iconSizeMap, resolvedSize)

  return (
    <ChakraButton
      type="submit"
      leftIcon={leftIcon ? <Icon boxSize={iconSize}>{leftIcon}</Icon> : undefined}
      rightIcon={rightIcon ? <Icon boxSize={iconSize}>{rightIcon}</Icon> : undefined}
      {...props}
    />
  )
}
