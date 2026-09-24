import { Box } from '@chakra-ui/react'
import { curves } from '@hoseki/packages/ui/design-system/animations/motion'
import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, useEffect, useRef } from 'react'

const easeEnter = `cubic-bezier(${curves.enter.join(', ')})`
const REVEAL_MS = 320
/** A whole decode wave, however long the text, finishes within this. */
const WAVE_MS = 420

/** Swaps an icon with a quarter turn and a fade, e.g. eye to eye-off. */
export function IconSwap({ swapKey, children }: { swapKey: string; children: ReactNode }): JSX.Element {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        key={swapKey}
        style={{ display: 'inline-flex' }}
        initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
        transition={{ duration: 0.3, ease: curves.enter }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  )
}

/** False on the first render, so values do not animate when a page simply loads. */
function useHasMounted(): boolean {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])
  return mounted.current
}

/**
 * Content that resolves out of a soft blur whenever `revealKey` changes after mount,
 * e.g. a balance being shown or hidden.
 */
export function RevealSpan({ revealKey, children }: { revealKey: string; children: ReactNode }): JSX.Element {
  const animate = useHasMounted()
  return (
    <Box
      as="span"
      key={revealKey}
      display="inline"
      sx={
        animate
          ? {
              animation: `sensitiveReveal ${REVEAL_MS}ms ${easeEnter} both`,
              '@keyframes sensitiveReveal': {
                from: { opacity: 0, filter: 'blur(6px)' },
                to: { opacity: 1, filter: 'blur(0)' },
              },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }
          : undefined
      }
    >
      {children}
    </Box>
  )
}

/**
 * Text that decodes character by character, left to right, whenever `revealKey` changes
 * after mount. Used for long secrets such as an extended public key.
 */
export function DecodeText({ text, revealKey }: { text: string; revealKey: string }): JSX.Element {
  const animate = useHasMounted()
  if (!animate) return <>{text}</>
  const step = Math.min(14, WAVE_MS / Math.max(1, text.length))
  return (
    <Box
      as="span"
      key={revealKey}
      sx={{
        '& > span': { animation: `decodeChar 260ms ${easeEnter} both` },
        '@keyframes decodeChar': {
          from: { opacity: 0, filter: 'blur(4px)' },
          to: { opacity: 1, filter: 'blur(0)' },
        },
        '@media (prefers-reduced-motion: reduce)': { '& > span': { animation: 'none' } },
      }}
    >
      {[...text].map((char, index) => (
        <span key={index} style={{ animationDelay: `${Math.round(index * step)}ms` }}>
          {char}
        </span>
      ))}
    </Box>
  )
}
