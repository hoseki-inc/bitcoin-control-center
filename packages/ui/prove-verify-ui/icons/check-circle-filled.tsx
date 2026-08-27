import { createIcon } from './create-icon'

export const CheckCircleFilledIcon = createIcon({
  displayName: 'CheckCircleFilledIcon',
  viewBox: '0 0 12 12',
  path: (props) => (
    <>
      <path
        d="M6.5 11C9.26142 11 11.5 8.76142 11.5 6C11.5 3.23858 9.26142 1 6.5 1C3.73858 1 1.5 3.23858 1.5 6C1.5 8.76142 3.73858 11 6.5 11Z"
        fill={props.color3 ?? 'currentColor'}
      />
      <path
        d="M5 6L6 7L8 5"
        stroke={props.color2 ?? 'white'}
        fill="none"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
})
