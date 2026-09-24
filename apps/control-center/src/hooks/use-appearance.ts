import { useColorMode } from '@chakra-ui/react'
import { useEffect, useSyncExternalStore } from 'react'
import { mediaQuery } from '../lib/media-query'

export type AppearancePreference = 'system' | 'light' | 'dark'
export type ResolvedAppearance = 'light' | 'dark'

// Also read by the pre-paint script in index.html; keep the key in sync.
export const APPEARANCE_STORAGE_KEY = 'control-center:appearance'
const CHANGE_EVENT = 'control-center:appearance-change'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function isPreference(value: unknown): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

let preference: AppearancePreference = 'system'

export function readAppearancePreference(): AppearancePreference {
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    preference = isPreference(stored) ? stored : 'system'
  } catch {
    // Keep the in-memory preference when browser storage is unavailable.
  }
  return preference
}

function systemAppearance(): ResolvedAppearance {
  return mediaQuery(DARK_QUERY)?.matches === true ? 'dark' : 'light'
}

export function resolveAppearance(value: AppearancePreference = readAppearancePreference()): ResolvedAppearance {
  return value === 'system' ? systemAppearance() : value
}

function subscribe(onChange: () => void): () => void {
  const media = mediaQuery(DARK_QUERY)
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  media?.addEventListener('change', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
    media?.removeEventListener('change', onChange)
  }
}

function getSnapshot(): string {
  const value = readAppearancePreference()
  return `${value}:${resolveAppearance(value)}`
}

export function useAppearance(): {
  preference: AppearancePreference
  resolved: ResolvedAppearance
  setPreference: (value: AppearancePreference) => void
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => 'system:light')
  const [storedValue, resolvedValue] = snapshot.split(':')
  const storedPreference = isPreference(storedValue) ? storedValue : 'system'
  const resolved: ResolvedAppearance = resolvedValue === 'dark' ? 'dark' : 'light'
  return {
    preference: storedPreference,
    resolved,
    setPreference: (value) => {
      preference = value
      try {
        localStorage.setItem(APPEARANCE_STORAGE_KEY, value)
      } catch {
        // The in-memory preference still works for this session.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT))
    },
  }
}

/** Keeps Chakra's colour mode in step with the stored preference and, for "system", the OS setting. */
export function AppearanceSync(): null {
  const { resolved } = useAppearance()
  const { colorMode, setColorMode } = useColorMode()
  useEffect(() => {
    if (colorMode !== resolved) {
      setColorMode(resolved)
    }
  }, [colorMode, resolved, setColorMode])
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0B0C10' : '#FFFFFF')
  }, [resolved])
  return null
}
