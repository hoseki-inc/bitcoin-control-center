import { IconButton, type IconButtonProps, Tooltip, useColorMode } from '@chakra-ui/react'
import { curves } from '@hoseki/packages/ui/design-system/animations/motion'
import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { type ResolvedAppearance, useAppearance } from '../hooks/use-appearance'

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> }
}

const REVEAL_MS = 520

/**
 * Light/dark switch. The new theme is revealed as a circle growing from the button,
 * using the View Transitions API where available; otherwise it switches instantly.
 */
export function AppearanceToggle(props: Omit<IconButtonProps, 'aria-label'>): JSX.Element {
  const { resolved, setPreference } = useAppearance()
  const { setColorMode } = useColorMode()
  const next: ResolvedAppearance = resolved === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode'

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    const apply = (): void => {
      setColorMode(next)
      setPreference(next)
    }
    const doc = document as ViewTransitionDocument
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (doc.startViewTransition === undefined || reduceMotion === true) {
      apply()
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const transition = doc.startViewTransition(() => flushSync(apply))
    void transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: REVEAL_MS,
          easing: `cubic-bezier(${curves.enter.join(', ')})`,
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
  }

  return (
    <Tooltip label={label}>
      <IconButton
        aria-label={label}
        variant="ghost"
        overflow="hidden"
        icon={
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={resolved}
              style={{ display: 'inline-flex' }}
              initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
              transition={{ duration: 0.3, ease: curves.enter }}
            >
              {resolved === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            </motion.span>
          </AnimatePresence>
        }
        onClick={handleClick}
        {...props}
      />
    </Tooltip>
  )
}
