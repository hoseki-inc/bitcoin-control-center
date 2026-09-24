/** The media query list, or null where matchMedia is missing (older engines, test DOMs). */
export function mediaQuery(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
}
