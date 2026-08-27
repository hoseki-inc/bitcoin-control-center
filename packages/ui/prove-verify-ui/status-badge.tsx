import { Badge, type BadgeProps, Icon, type IconProps, Text, forwardRef } from '@chakra-ui/react'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

export type Status = 'info' | 'warning' | 'success' | 'error' | 'neutral'

// Union type for different icon types
type IconComponent =
  | LucideIcon // Lucide React icons
  | ComponentType<IconProps> // Chakra createIcon components
  | ComponentType<{ className?: string; size?: number | string }> // Generic SVG components

export interface StatusBadgeProps extends BadgeProps {
  status: Status
  label: string
  size?: 'sm' | 'md'
  icon?: IconComponent
}

export const StatusBadge = forwardRef<StatusBadgeProps, 'span'>(
  ({ status, label, icon, size = 'md', ...props }, ref) => {
    const { bgColor, color } = getBadgeColors(status)
    const { py, px, textStyle } = getBadgeSize(size)
    return (
      <Badge
        ref={ref}
        display="flex"
        alignItems="center"
        py={py}
        px={px}
        borderRadius="full"
        textTransform="capitalize"
        bgColor={bgColor}
        color={color}
        fontWeight="medium"
        {...props}
      >
        {icon && <Icon as={icon} mr={1} boxSize={3} />}
        <Text textStyle={textStyle}>{label}</Text>
      </Badge>
    )
  },
)

function getBadgeColors(status: Status) {
  if (status === 'warning') {
    return {
      bgColor: 'warning.50',
      color: 'warning.500',
    }
  } else if (status === 'success') {
    return {
      bgColor: 'success.50',
      color: 'success.500',
    }
  } else if (status === 'error') {
    return {
      bgColor: 'error.50',
      color: 'error.500',
    }
  } else if (status === 'neutral') {
    return {
      bgColor: 'neutral.100',
      color: 'neutral.700',
    }
  }

  // info status
  return {
    bgColor: 'blue.50',
    color: 'blue.500',
  }
}

function getBadgeSize(size: StatusBadgeProps['size']) {
  if (size === 'sm') {
    return {
      py: 0,
      px: 1.5,
      textStyle: 'text/xs',
    }
  } else {
    return {
      py: 0.5,
      px: 2.5,
      textStyle: 'text/sm',
    }
  }
}
