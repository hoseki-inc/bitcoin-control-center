import type { ReactNode } from 'react'
import { usePrivacy } from '../hooks/use-privacy'
import { RevealSpan } from './reveal'

/**
 * Replace private content instead of leaving readable values behind a visual blur.
 * Toggling privacy resolves the new state out of a soft blur.
 */
export function SensitiveValue({ children }: { children: ReactNode }): JSX.Element {
  const { hidden } = usePrivacy()
  return (
    <RevealSpan revealKey={hidden ? 'hidden' : 'shown'}>
      {hidden ? <span aria-label="Hidden value">****</span> : children}
    </RevealSpan>
  )
}
