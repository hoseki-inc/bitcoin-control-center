import { createIcon } from './create-icon'

export const RoundKeyIcon = createIcon({
  displayName: 'RoundKeyIcon',
  viewBox: '0 0 24 24',
  path: (props) => (
    <>
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <circle cx="17" cy="7" r="1.75" fill={props.color2 ?? 'currentColor'} />
    </>
  ),
})
