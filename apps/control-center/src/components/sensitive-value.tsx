import type { ReactNode } from 'react'
import { usePrivacy } from '../hooks/use-privacy'

/** Replace private content instead of leaving readable values behind a visual blur. */
export function SensitiveValue({ children }: { children: ReactNode }): JSX.Element {
  const { hidden } = usePrivacy()
  return <>{hidden ? <span aria-label="Hidden value">****</span> : children}</>
}
