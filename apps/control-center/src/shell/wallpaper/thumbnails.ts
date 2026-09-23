import { useEffect, useState } from 'react'
import { WALLPAPER_PRESETS, type WallpaperMode } from './presets'
import { WallpaperRenderer } from './renderer'
import { type WallpaperSeed } from './use-wallpaper'

const THUMB_WIDTH = 320
const THUMB_HEIGHT = 200
/** A moment where every family has settled into an interesting frame. */
const THUMB_TIME = 24

/**
 * Still previews of every preset for pickers. One offscreen WebGL context renders them
 * all in turn, so a picker never holds a context per tile.
 */
export function useWallpaperThumbnails(mode: WallpaperMode, seed: WallpaperSeed): Record<string, string> {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  useEffect(() => {
    const canvas = document.createElement('canvas')
    const renderer = WallpaperRenderer.create(canvas)
    if (renderer === null) return
    const next: Record<string, string> = {}
    for (const preset of WALLPAPER_PRESETS) {
      const drawn = renderer.render({ preset, mode, seed, time: THUMB_TIME, width: THUMB_WIDTH, height: THUMB_HEIGHT })
      if (drawn) next[preset.id] = canvas.toDataURL('image/jpeg', 0.85)
    }
    renderer.dispose()
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
    setThumbnails(next)
  }, [mode, seed])

  return thumbnails
}
