import { animate, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

/**
 * Eases from 0 to 1 once `hasArrived` turns true, for counting a value up from zero.
 * With reduced motion it is 1 straight away.
 */
export function useCountUpProgress(hasArrived: boolean, durationSeconds = 1.2): number {
  const reduceMotion = useReducedMotion() === true
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (reduceMotion || !hasArrived) {
      return
    }
    const controls = animate(0, 1, { duration: durationSeconds, ease: 'easeOut', onUpdate: setProgress })
    return () => {
      controls.stop()
    }
  }, [reduceMotion, hasArrived, durationSeconds])

  return reduceMotion ? 1 : progress
}
