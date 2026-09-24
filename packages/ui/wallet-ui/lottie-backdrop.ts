/**
 * The wallet animations were drawn for white pages: a full-frame white solid sits behind
 * everything, and more white solids fade in or out to loop. On dark glass those become a
 * white rectangle and white flashes, so dark mode drops them and keeps the artwork.
 *
 * Only plain backdrops go: full-frame white solids with no mask, no parent and no track
 * matte role. White solids that draw part of the scene (a masked device screen) stay.
 */

interface LottieLayer {
  ty?: number
  sc?: string
  sw?: number
  sh?: number
  td?: number
  parent?: number
  masksProperties?: unknown[]
}

interface LottieData {
  w?: number
  h?: number
  layers?: LottieLayer[]
  assets?: Array<{ p?: string }>
}

const SOLID = 1

function isWhite(color: string | undefined): boolean {
  return color !== undefined && /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(color)
}

export function isWhiteBackdrop(layer: LottieLayer, width: number, height: number): boolean {
  return (
    layer.ty === SOLID &&
    isWhite(layer.sc) &&
    (layer.sw ?? 0) >= width &&
    (layer.sh ?? 0) >= height &&
    (layer.masksProperties?.length ?? 0) === 0 &&
    layer.td === undefined &&
    layer.parent === undefined
  )
}

/** A copy of the animation without its white backdrops. The input is never modified. */
export function withoutWhiteBackdrops<T extends object>(animation: T): T {
  const data = animation as LottieData
  if (data.layers === undefined) {
    return animation
  }
  const width = data.w ?? 0
  const height = data.h ?? 0
  return { ...animation, layers: data.layers.filter((layer) => !isWhiteBackdrop(layer, width, height)) }
}

/** Animations built from raster frames carry their white inside the images. */
export function hasRasterFrames(animation: object): boolean {
  return ((animation as LottieData).assets ?? []).some((asset) => typeof asset.p === 'string' && asset.p !== '')
}
