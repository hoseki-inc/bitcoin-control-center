import { createIcon } from '@chakra-ui/react'

export const XCircleFilledIcon = createIcon({
  displayName: 'XCircleFilledIcon',
  viewBox: '0 0 12 12',
  path: (
    <>
      <path
        d="M6 11C8.76142 11 11 8.76142 11 6C11 3.23858 8.76142 1 6 1C3.23858 1 1 3.23858 1 6C1 8.76142 3.23858 11 6 11Z"
        fill="currentColor"
      />
      <path d="M7.5 4.5L4.5 7.5" stroke="white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 4.5L7.5 7.5" stroke="white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
})
