import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_WALLPAPER_ID, WALLPAPER_FAMILIES, WALLPAPER_PRESETS, getWallpaperPreset } from './presets'

vi.mock('../../trpc', () => ({ trpc: {} }))

const { seedFromHash } = await import('./use-wallpaper')

describe('wallpaper presets', () => {
  it('has unique ids and a valid default', () => {
    const ids = WALLPAPER_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_WALLPAPER_ID)
  })

  it('covers every family with two presets', () => {
    for (const { family } of WALLPAPER_FAMILIES) {
      expect(WALLPAPER_PRESETS.filter((preset) => preset.family === family)).toHaveLength(2)
    }
  })

  it.each(WALLPAPER_PRESETS.map((preset) => [preset.id, preset] as const))(
    '%s has five hex colours for each mode',
    (_id, preset) => {
      for (const mode of ['light', 'dark'] as const) {
        expect(preset.palettes[mode]).toHaveLength(5)
        for (const colour of preset.palettes[mode]) {
          expect(colour).toMatch(/^#[0-9A-F]{6}$/i)
        }
      }
    },
  )

  it('falls back to the first preset for unknown ids', () => {
    expect(getWallpaperPreset('missing').id).toBe(WALLPAPER_PRESETS[0].id)
  })
})

describe('seedFromHash', () => {
  it('turns a block hash into four numbers in [0, 1)', () => {
    const seed = seedFromHash('00000000000000000001a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7')
    expect(seed).toHaveLength(4)
    for (const value of seed) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('changes with the hash tail', () => {
    const a = seedFromHash('0'.repeat(32) + '1'.repeat(32))
    const b = seedFromHash('0'.repeat(32) + '2'.repeat(32))
    expect(a).not.toEqual(b)
  })

  it('uses a stable fallback when there is no valid hash', () => {
    expect(seedFromHash(undefined)).toEqual(seedFromHash('not-a-hash'))
  })
})
