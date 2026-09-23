import { useMemo, useSyncExternalStore } from 'react'
import { trpc } from '../../trpc'
import { DEFAULT_WALLPAPER_ID, type WallpaperPreset, getWallpaperPreset } from './presets'

const STORAGE_KEY = 'control-center:wallpaper'
const CHANGE_EVENT = 'control-center:wallpaper-change'
let selected = DEFAULT_WALLPAPER_ID

function getSnapshot(): string {
  try {
    selected = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_WALLPAPER_ID
  } catch {
    // Keep the in-memory choice when browser storage is unavailable.
  }
  return getWallpaperPreset(selected).id
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useWallpaper(): { preset: WallpaperPreset; setWallpaper: (id: string) => void } {
  const id = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_WALLPAPER_ID)
  return {
    preset: getWallpaperPreset(id),
    setWallpaper: (next) => {
      selected = next
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // The in-memory choice still works for this session.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT))
    },
  }
}

export type WallpaperSeed = readonly [number, number, number, number]

const FALLBACK_SEED: WallpaperSeed = [0.137, 0.618, 0.271, 0.828]

/** Four numbers in [0, 1) taken from a 64-character block hash. */
export function seedFromHash(hash: string | undefined): WallpaperSeed {
  if (hash === undefined || !/^[0-9a-f]{64}$/i.test(hash)) return FALLBACK_SEED
  // Skip the leading zeros of proof-of-work; the tail of the hash carries the entropy.
  const tail = hash.slice(32)
  const part = (index: number): number => Number.parseInt(tail.slice(index * 8, index * 8 + 8), 16) / 2 ** 32
  return [part(0), part(1), part(2), part(3)]
}

/** The latest block hash seeds the Bitcoin wallpapers; the pattern shifts slightly with each block. */
export function useBlockSeed(enabled: boolean): WallpaperSeed {
  const tip = trpc.blocks.tip.useQuery(undefined, { enabled, refetchInterval: 60_000, staleTime: 30_000 })
  const hash = tip.data?.hash
  // Stable identity per block, so effects keyed on the seed only rerun when a block arrives.
  return useMemo(() => seedFromHash(hash), [hash])
}
