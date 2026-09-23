/**
 * Displacement map for "liquid glass" refraction.
 *
 * The glass is modelled as a slab whose rim is a convex dome: flat in the middle,
 * curving down to vertical at the edge over a `bevel` band. Light entering the
 * curved rim bends (Snell's law), so each rim pixel shows background from a little
 * further out along the surface normal. The interior stays neutral and readable.
 *
 * Channels, for SVG `feDisplacementMap`:
 * - R: horizontal offset, 128 = none
 * - G: vertical offset, 128 = none
 * - B: rim mask, 255 at the edge fading to 0 at the inner edge of the bevel
 */

export interface GlassMapOptions {
  /** Element width in CSS pixels. */
  width: number
  /** Element height in CSS pixels. */
  height: number
  /** Corner radius in CSS pixels (clamped to half the shorter side). */
  radius: number
  /** Width of the curved rim in CSS pixels (clamped to half the shorter side). */
  bevel: number
  /** Device pixel ratio for the map; capped at 2. */
  dpr?: number
  /** Index of refraction of the glass. */
  ior?: number
}

export interface GlassMap {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

const NEUTRAL = 128
const RANGE = 127

/** Slope of the dome surface at `u` (0 = outer rim, 1 = where the rim meets the flat top). */
function domeSlope(u: number): number {
  const inv = 1 - u
  const denominator = Math.pow(1 - Math.pow(inv, 4), 0.75)
  return denominator <= 1e-6 ? Number.POSITIVE_INFINITY : Math.pow(inv, 3) / denominator
}

/** Lateral bend through the glass for a surface normal tilted by `incidence` radians. */
function refractionBend(incidence: number, ior: number): number {
  return Math.sin(incidence - Math.asin(Math.sin(incidence) / ior))
}

export function buildGlassMap({ width, height, radius, bevel, dpr = 1, ior = 1.5 }: GlassMapOptions): GlassMap {
  const scale = Math.min(Math.max(dpr, 1), 2)
  const mapWidth = Math.max(1, Math.round(width * scale))
  const mapHeight = Math.max(1, Math.round(height * scale))
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4)

  const halfW = width / 2
  const halfH = height / 2
  const r = Math.max(0, Math.min(radius, halfW, halfH))
  const band = Math.max(0.5, Math.min(bevel, halfW, halfH))
  const maxBend = refractionBend(Math.PI / 2, ior)

  for (let py = 0; py < mapHeight; py++) {
    const y = (py + 0.5) / scale - halfH
    for (let px = 0; px < mapWidth; px++) {
      const x = (px + 0.5) / scale - halfW
      const i = (py * mapWidth + px) * 4

      // Signed distance to the rounded rectangle (negative inside).
      const qx = Math.abs(x) - (halfW - r)
      const qy = Math.abs(y) - (halfH - r)
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
      const sdf = outside + Math.min(Math.max(qx, qy), 0) - r
      const depth = -sdf

      let red = NEUTRAL
      let green = NEUTRAL
      let blue = 0

      if (depth >= 0 && depth < band) {
        // Outward surface normal of the rounded rectangle at this point.
        let nx: number
        let ny: number
        if (qx > 0 && qy > 0) {
          const length = Math.hypot(qx, qy)
          nx = (Math.sign(x) * qx) / length
          ny = (Math.sign(y) * qy) / length
        } else if (qx > qy) {
          nx = Math.sign(x)
          ny = 0
        } else {
          nx = 0
          ny = Math.sign(y)
        }

        const u = depth / band
        const incidence = Math.atan(domeSlope(u))
        const bend = maxBend > 0 ? refractionBend(incidence, ior) / maxBend : 0

        red = NEUTRAL + nx * bend * RANGE
        green = NEUTRAL + ny * bend * RANGE
        blue = 255 * (1 - u)
      }

      data[i] = red
      data[i + 1] = green
      data[i + 2] = blue
      data[i + 3] = 255
    }
  }

  return { width: mapWidth, height: mapHeight, data }
}
