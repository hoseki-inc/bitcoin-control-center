import { useEffect, useState } from 'react'

/** How long something must be loading before a skeleton or spinner appears, so quick loads never flash one. */
export const LOADING_DELAY_MS = 300

/** True once `active` has stayed true for `delayMs`; false as soon as it turns false. */
export function useDelayedFlag(active: boolean, delayMs: number = LOADING_DELAY_MS): boolean {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    if (!active) {
      setElapsed(false)
      return
    }
    const timer = setTimeout(() => {
      setElapsed(true)
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [active, delayMs])

  return active && elapsed
}
