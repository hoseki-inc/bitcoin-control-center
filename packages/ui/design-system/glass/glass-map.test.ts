import { describe, expect, it } from 'vitest'
import { buildGlassMap } from './glass-map'

function pixel(map: ReturnType<typeof buildGlassMap>, x: number, y: number): [number, number, number, number] {
  const i = (y * map.width + x) * 4
  return [map.data[i], map.data[i + 1], map.data[i + 2], map.data[i + 3]]
}

describe('buildGlassMap', () => {
  const map = buildGlassMap({ width: 300, height: 80, radius: 16, bevel: 24, dpr: 2 })

  it('renders at the device pixel ratio, capped at 2', () => {
    expect([map.width, map.height]).toEqual([600, 160])
    const capped = buildGlassMap({ width: 10, height: 10, radius: 2, bevel: 3, dpr: 3 })
    expect(capped.width).toBe(20)
  })

  it('leaves the interior neutral so content stays undistorted', () => {
    expect(pixel(map, 300, 80)).toEqual([128, 128, 0, 255])
  })

  it('bends outward at the rim, strongest at the edge', () => {
    const edge = pixel(map, 1, 80)[0]
    const mid = pixel(map, 20, 80)[0]
    const inner = pixel(map, 44, 80)[0]
    // Left rim samples further left: red below neutral, easing back towards neutral inwards.
    expect(edge).toBeLessThan(mid)
    expect(mid).toBeLessThan(inner)
    expect(inner).toBeLessThanOrEqual(128)
    expect(edge).toBeLessThan(40)
  })

  it('is mirror-symmetric across both axes', () => {
    const [leftR] = pixel(map, 4, 80)
    const [rightR] = pixel(map, map.width - 5, 80)
    expect(leftR - 128).toBeCloseTo(-(rightR - 128), -0.5)
    const [, topG] = pixel(map, 300, 4)
    const [, bottomG] = pixel(map, 300, map.height - 5)
    expect(topG - 128).toBeCloseTo(-(bottomG - 128), -0.5)
  })

  it('bends diagonally in rounded corners', () => {
    const [r, g] = pixel(map, 14, 14)
    expect(r).toBeLessThan(128)
    expect(g).toBeLessThan(128)
  })

  it('writes a rim mask that fades from the edge inwards', () => {
    expect(pixel(map, 1, 80)[2]).toBeGreaterThan(240)
    expect(pixel(map, 30, 80)[2]).toBeLessThan(pixel(map, 10, 80)[2])
    expect(pixel(map, 300, 80)[2]).toBe(0)
  })
})
