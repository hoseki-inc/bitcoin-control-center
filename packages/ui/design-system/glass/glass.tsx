import { Box, type BoxProps, forwardRef } from '@chakra-ui/react'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { buildGlassMap } from './glass-map'

export interface GlassOptions {
  /** Maximum displacement at the rim, in CSS pixels. */
  scale?: number
  /** Chromatic spread between colour channels (0 = none). */
  chroma?: number
  /** Width of the curved rim in CSS pixels, or 'dome' for a fully curved surface. */
  bevel?: number | 'dome'
  /** Backdrop blur in CSS pixels applied after refraction. */
  blur?: number
  saturate?: number
  brightness?: number
  /** Fill painted over the refracted backdrop (a colour or gradient). */
  tint?: string
  /** Draw the edge highlight and inner shine. */
  shine?: boolean
}

export type GlassProps = GlassOptions & BoxProps

/** Force plain frosted glass inside scaled previews, where refraction maps would be the wrong size. */
export const GlassFrostedContext = createContext(false)

interface Lens {
  id: string
  url: string
  width: number
  height: number
}

const REBUILD_DEBOUNCE_MS = 150

let refractionSupport: boolean | undefined

/**
 * `backdrop-filter: url(#svg-filter)` only paints in Chromium. Safari and Firefox accept
 * the syntax but render nothing, so they get frosted glass instead.
 */
export function supportsGlassRefraction(): boolean {
  if (refractionSupport !== undefined) return refractionSupport
  if (typeof navigator === 'undefined' || typeof CSS === 'undefined') return (refractionSupport = false)
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData
    ?.brands
  const chromium =
    brands?.some(({ brand }) => /Chromium|Google Chrome|Microsoft Edge/.test(brand)) ??
    /Chrome\/\d+/.test(navigator.userAgent)
  refractionSupport = chromium && CSS.supports('backdrop-filter', 'url(#glass) blur(1px)')
  return refractionSupport
}

function parseRadius(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function encodeLens(width: number, height: number, radius: number, bevel: number): Promise<{ url: string }> {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  const map = buildGlassMap({ width, height, radius, bevel, dpr })
  const canvas = document.createElement('canvas')
  canvas.width = map.width
  canvas.height = map.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Canvas 2D unavailable')
  context.putImageData(new ImageData(map.data, map.width, map.height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (blob === null) throw new Error('Could not encode glass map')
  const url = URL.createObjectURL(blob)
  // Decode before use: an undecoded map makes the backdrop jump by half the scale for a frame.
  const image = new Image()
  image.src = url
  await image.decode()
  return { url }
}

/**
 * Liquid glass surface. In Chromium the backdrop is refracted through a generated
 * displacement map (three passes, one per colour channel, for a chromatic rim);
 * elsewhere, and when transparency is reduced, it falls back to frosted material.
 */
export const Glass = forwardRef<GlassProps, 'div'>(function Glass(
  {
    scale = 66,
    chroma = 0.2,
    bevel = 'dome',
    blur = 1.5,
    saturate = 1.5,
    brightness = 0.9,
    tint = 'transparent',
    shine = true,
    children,
    ...rest
  },
  forwardedRef,
) {
  const forcedFrosted = useContext(GlassFrostedContext)
  const refract = !forcedFrosted && supportsGlassRefraction()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const uid = useId().replace(/:/g, '')
  const [lens, setLens] = useState<Lens | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!refract || host === null) return
    let cancelled = false
    let build = 0
    let timer: number | undefined
    let frame: number | undefined
    let first = true

    const rebuild = (): void => {
      const width = host.offsetWidth
      const height = host.offsetHeight
      if (width === 0 || height === 0) return
      const radius = parseRadius(getComputedStyle(host).borderTopLeftRadius)
      const rim = bevel === 'dome' ? Math.min(width, height) / 2 : bevel
      const version = ++build
      encodeLens(width, height, radius, rim)
        .then(({ url }) => {
          if (cancelled || version !== build) {
            URL.revokeObjectURL(url)
            return
          }
          // A fresh id per build: Chromium caches filter output by id.
          setLens({ id: `glass-${uid}-${version}`, url, width, height })
        })
        .catch(() => undefined)
    }

    const observer = new ResizeObserver(() => {
      if (first) {
        first = false
        frame = window.requestAnimationFrame(rebuild)
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(rebuild, REBUILD_DEBOUNCE_MS)
    })
    observer.observe(host)
    return () => {
      cancelled = true
      observer.disconnect()
      window.clearTimeout(timer)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [refract, bevel, uid])

  // Release each map once a newer one (or unmount) replaces it.
  useEffect(() => () => (lens !== null ? URL.revokeObjectURL(lens.url) : undefined), [lens])

  const tone = `blur(${blur}px) saturate(${saturate}) brightness(${brightness})`
  const frosted = `blur(${Math.max(blur * 3, 8)}px) saturate(${saturate}) brightness(${brightness})`
  const backdrop = refract && lens !== null ? `url(#${lens.id}) ${tone}` : frosted

  return (
    <Box
      ref={(node: HTMLDivElement | null) => {
        hostRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      position="relative"
      isolation="isolate"
      {...rest}
    >
      <Box
        aria-hidden
        position="absolute"
        inset={0}
        zIndex={-1}
        borderRadius="inherit"
        pointerEvents="none"
        bg={tint}
        sx={{
          backdropFilter: backdrop,
          WebkitBackdropFilter: frosted,
          '@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)': {
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
            bg: 'var(--material-tint)',
          },
        }}
      />
      {shine && (
        <Box aria-hidden position="absolute" inset={0} zIndex={-1} borderRadius="inherit" layerStyle="glassShine" />
      )}
      {refract && lens !== null && (
        <svg aria-hidden width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
          <filter
            id={lens.id}
            x="0"
            y="0"
            width={lens.width}
            height={lens.height}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={lens.url}
              x="0"
              y="0"
              width={lens.width}
              height={lens.height}
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={scale * (1 + chroma)}
              xChannelSelector="R"
              yChannelSelector="G"
              result="shiftRed"
            />
            <feColorMatrix in="shiftRed" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={scale}
              xChannelSelector="R"
              yChannelSelector="G"
              result="shiftGreen"
            />
            <feColorMatrix
              in="shiftGreen"
              type="matrix"
              values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
              result="green"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={scale * (1 - chroma)}
              xChannelSelector="R"
              yChannelSelector="G"
              result="shiftBlue"
            />
            <feColorMatrix
              in="shiftBlue"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
              result="blue"
            />
            <feBlend in="red" in2="green" mode="screen" result="redGreen" />
            <feBlend in="redGreen" in2="blue" mode="screen" />
          </filter>
        </svg>
      )}
      {children}
    </Box>
  )
})
