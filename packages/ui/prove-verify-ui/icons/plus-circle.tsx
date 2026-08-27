import { createIcon } from './create-icon'

export const PlusCircleIcon = createIcon({
  displayName: 'PlusCircleIcon',
  viewBox: '0 0 24 24',
  defaultProps: {
    fill: 'none',
    strokeWidth: '2',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  path: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" stroke="currentColor" strokeWidth="1" />
      <path d="M12 8v8" stroke="currentColor" strokeWidth="1" />
    </>
  ),
})
