import { useEffect, useState } from 'react'

export type FadingNotice = 'shown' | 'fading' | null

// A confirmation such as "Tor ready" stays long enough to read, then fades.
const NOTICE_VISIBLE_MS = 3000
export const NOTICE_FADE_MS = 600

export function useFadingNotice(): [FadingNotice, (notice: 'shown' | null) => void] {
  const [notice, setNotice] = useState<FadingNotice>(null)
  // Timers rather than an animation, so the notice stays readable when motion is reduced.
  useEffect(() => {
    if (notice === null) {
      return undefined
    }
    const timer = setTimeout(
      () => {
        setNotice(notice === 'shown' ? 'fading' : null)
      },
      notice === 'shown' ? NOTICE_VISIBLE_MS : NOTICE_FADE_MS,
    )
    return (): void => {
      clearTimeout(timer)
    }
  }, [notice])
  return [notice, setNotice]
}
