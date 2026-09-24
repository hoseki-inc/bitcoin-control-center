import { Box, usePrefersReducedMotion } from '@chakra-ui/react'
import { curves, durations } from '@hoseki/packages/ui/design-system/animations/motion'
import { useEffect, useRef, useState } from 'react'
import { type WallpaperMode, type WallpaperPreset, wallpaperFallback } from './presets'
import { WallpaperRenderer } from './renderer'
import type { WallpaperSeed } from './use-wallpaper'

export interface WallpaperProps {
  preset: WallpaperPreset
  mode: WallpaperMode
  seed: WallpaperSeed
  /** Stop animating, e.g. while a sheet covers the wallpaper. */
  paused?: boolean
  /** Fill the viewport (default) or the nearest positioned parent. */
  fixed?: boolean
  /** Receives an image URL of the current look, used as the cheap blurred backdrop inside sheets. */
  onSnapshot?: (url: string) => void
}

const FPS = 30
const easeEnter = `cubic-bezier(${curves.enter.join(', ')})`

function renderScale(): number {
  // Wallpapers are soft by nature; half resolution (never below 0.6x) keeps the GPU cool.
  return Math.max(0.6, Math.min(window.devicePixelRatio, 2) * 0.5)
}

export function Wallpaper({
  preset,
  mode,
  seed,
  paused = false,
  fixed = true,
  onSnapshot,
}: WallpaperProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<WallpaperRenderer | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const [failed, setFailed] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [previous, setPrevious] = useState<string | null>(null)
  const snapshotRef = useRef<string | null>(null)
  const wantSnapshotRef = useRef(true)
  const timeRef = useRef(0)
  const lookRef = useRef({ preset, mode, seed, onSnapshot })
  lookRef.current = { preset, mode, seed, onSnapshot }

  const draw = (): void => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    if (canvas === null || renderer === null) {
      return
    }
    const scale = renderScale()
    const width = Math.max(1, Math.round(canvas.clientWidth * scale))
    const height = Math.max(1, Math.round(canvas.clientHeight * scale))
    const look = lookRef.current
    if (!renderer.render({ ...look, time: timeRef.current, width, height })) {
      return
    }
    if (!wantSnapshotRef.current) {
      return
    }
    wantSnapshotRef.current = false
    // Read the frame back in the same task, before the drawing buffer is discarded.
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          return
        }
        const url = URL.createObjectURL(blob)
        const old = snapshotRef.current
        snapshotRef.current = url
        look.onSnapshot?.(url)
        setRevealed(true)
        if (old !== null) {
          window.setTimeout(() => {
            URL.revokeObjectURL(old)
          }, durations.wallpaperReveal + 500)
        }
      },
      'image/jpeg',
      0.9,
    )
  }

  // Create the renderer, and recover if the GPU drops the context.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) {
      return
    }
    const setup = (): void => {
      rendererRef.current = WallpaperRenderer.create(canvas)
      setFailed(rendererRef.current === null)
      wantSnapshotRef.current = true
      draw()
    }
    const onLost = (event: Event): void => {
      event.preventDefault()
      rendererRef.current = null
    }
    setup()
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', setup)
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', setup)
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
    // draw reads everything it needs from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new look crossfades from a snapshot of the old one.
  useEffect(() => {
    if (snapshotRef.current !== null) {
      setPrevious(snapshotRef.current)
    }
    wantSnapshotRef.current = true
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.id, mode, seed[0], seed[1], seed[2], seed[3]])

  // Animation loop: 30fps, paused while hidden or covered; a single still frame under reduced motion.
  useEffect(() => {
    if (paused || reducedMotion) {
      draw()
      return
    }
    let frame = 0
    let last = performance.now()
    let lastDraw = 0
    const tick = (now: number): void => {
      frame = window.requestAnimationFrame(tick)
      const delta = Math.min(now - last, 100) / 1000
      last = now
      if (document.hidden) {
        return
      }
      timeRef.current += delta * lookRef.current.preset.speed
      if (now - lastDraw < 1000 / FPS - 2) {
        return
      }
      lastDraw = now
      draw()
    }
    frame = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, reducedMotion])

  useEffect(() => {
    const onResize = (): void => {
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reveal = reducedMotion ? 'none' : `wallpaperReveal ${durations.wallpaperReveal}ms ${easeEnter} both`

  return (
    <Box
      aria-hidden
      position={fixed ? 'fixed' : 'absolute'}
      inset={0}
      overflow="clip"
      pointerEvents="none"
      bg={wallpaperFallback(preset, mode)}
      zIndex={0}
    >
      <Box
        as="canvas"
        ref={canvasRef}
        display={failed ? 'none' : 'block'}
        w="100%"
        h="100%"
        opacity={revealed ? 1 : 0}
        sx={{
          animation: revealed ? reveal : 'none',
          '@keyframes wallpaperReveal': {
            from: { opacity: 0, filter: 'blur(12px)', transform: 'scale(1.25)' },
            to: { opacity: 1, filter: 'blur(0)', transform: 'scale(1)' },
          },
        }}
      />
      {previous !== null && (
        <Box
          as="img"
          src={previous}
          alt=""
          position="absolute"
          inset={0}
          w="100%"
          h="100%"
          objectFit="cover"
          onAnimationEnd={() => {
            setPrevious(null)
          }}
          sx={{
            animation: reducedMotion
              ? 'wallpaperFadeOut 150ms ease-out both'
              : `wallpaperFadeOut ${durations.wallpaperReveal}ms ${easeEnter} both`,
            '@keyframes wallpaperFadeOut': {
              from: { opacity: 1, transform: 'scale(1)' },
              to: { opacity: 0, transform: reducedMotion ? 'scale(1)' : 'scale(1.25)' },
            },
          }}
        />
      )}
    </Box>
  )
}
