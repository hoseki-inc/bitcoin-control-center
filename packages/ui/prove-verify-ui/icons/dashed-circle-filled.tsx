import { chakra } from '@chakra-ui/react'
import { createIcon } from './create-icon'

export const DashedCircleFilledIcon = createIcon({
  displayName: 'DashedCircleFilledIcon',
  viewBox: '0 0 16 16',
  path: (props) => (
    <chakra.path
      d="M7.51953 15.3672C11.3855 15.3672 14.5195 12.2332 14.5195 8.36719C14.5195 4.50119 11.3855 1.36719 7.51953 1.36719C3.65354 1.36719 0.519531 4.50119 0.519531 8.36719C0.519531 12.2332 3.65354 15.3672 7.51953 15.3672Z"
      fill={props.fill ?? 'surface.muted'}
      stroke={props.stroke ?? 'text.disabled'}
      strokeLinecap="round"
      strokeDasharray="3 3"
    />
  ),
})
