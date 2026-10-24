import { Box } from '@chakra-ui/react'
import { AnimatePresence, type HTMLMotionProps, motion } from 'framer-motion'
import { type ReactNode, useEffect } from 'react'
import { toast } from 'sonner'
import { queryClient } from '../trpc'
import { forgetApp, lockApp, usePinStatus } from './actions'
import { appMounted, currentEpoch, dispatch, screenFor, useGate } from './gate'
import { InsecureScreen, SetupScreen, SignInScreen, StartOsSetupScreen, UnreachableScreen } from './pin-screens'

/**
 * Locks when the desktop window closes (heard at every stage, since a tab signs in before the app opens), and when the
 * browser brings the page back from Back or Forward exactly as it was left. A session never ends just from sitting
 * unused.
 */
function useLockTriggers(pinsOn: boolean): void {
  // The desktop always has PINs, so it listens before Sentinel's first answer: a lock then drops that answer.
  useEffect(
    () =>
      window.desktop?.pin?.onLock(() => {
        void lockApp()
      }),
    [],
  )

  useEffect(() => {
    if (!pinsOn) {
      return
    }
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        void lockApp('once')
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return (): void => {
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [pinsOn])
}

// Leaving, the lock screen fades through white: its content (the check) shrinks slightly and fades first, then
// the blank screen gives way as the app fades in and settles into place.
const CONTENT_OUT_S = 0.25
const REVEAL_S = 0.45
const REVEAL_EASE = [0.4, 0, 0.2, 1] as const
// The lock screen takes 0.25s to fade in over the app; unmount the app by this time even if that fade stalls.
const COVER_LIMIT_MS = 400
// How long the finished check may wait for the app to mount and load its first data, so loading states don't pop in
// after the fade. Home's first overview can take over half a second while Sentinel fetches the price.
const SETTLE_LIMIT_MS = 1500
// Pages can start more requests a render or two after mounting, so the app counts as settled only once nothing has
// been loading for this long.
const QUIET_MS = 100

// Variant names carry from the lock screen to its content, so one exit plays both in order.
const overlayFade: HTMLMotionProps<'div'> = {
  variants: {
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } },
    gone: { opacity: 0, transition: { delay: CONTENT_OUT_S, duration: REVEAL_S, ease: REVEAL_EASE } },
  },
  initial: 'hidden',
  animate: 'shown',
  exit: 'gone',
}

// The content layer fills the screen like the lock screen itself, so its scale doesn't move the fixed screens inside.
const contentFade: HTMLMotionProps<'div'> = {
  variants: {
    hidden: { opacity: 1, scale: 1 },
    shown: { opacity: 1, scale: 1 },
    gone: { opacity: 0, scale: 0.96, transition: { duration: CONTENT_OUT_S, ease: 'easeIn' } },
  },
  style: { position: 'fixed', inset: 0 },
}

// The app's resting state is no transform at all, so its fixed headers and dialogs keep their place.
const APP_MOTION = {
  revealing: { opacity: 0, y: 8 },
  open: { opacity: 1, y: 0, transition: { delay: CONTENT_OUT_S, duration: REVEAL_S, ease: REVEAL_EASE } },
  covering: { opacity: 0, transition: { duration: 0.25 } },
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// Resolves the reveal's wait for the app's first render. A large first render can take longer than a few frames.
let onCommitted: (() => void) | null = null

/** Reports when the app's first render has committed, after its own effects have started its requests. */
function Committed(): null {
  useEffect(() => {
    onCommitted?.()
    onCommitted = null
  }, [])
  return null
}

/**
 * Signed in: the app mounts under the finished check, waits for its first data (up to a limit), and only then does
 * the lock screen fade away, over an app that's already drawn. A lock meanwhile drops the reveal.
 */
async function reveal(): Promise<void> {
  const epoch = currentEpoch()
  const start = performance.now()
  const committed = new Promise<void>((resolve) => {
    onCommitted = resolve
  })
  dispatch({ type: 'reveal', epoch })
  await Promise.race([committed, wait(SETTLE_LIMIT_MS)])
  // Twice, so the mounted app is on screen.
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve)
    })
  })
  let quietSince = performance.now()
  while (performance.now() - start < SETTLE_LIMIT_MS && performance.now() - quietSince < QUIET_MS) {
    if (queryClient.isFetching() > 0) {
      quietSince = performance.now()
    }
    await wait(25)
  }
  dispatch({ type: 'revealed', epoch })
}

function startReveal(): void {
  void reveal()
}

function finishCovering(): void {
  dispatch({ type: 'covered' })
}

/**
 * Shows the PIN screens until this tab is signed in. Behind a lock screen the app isn't mounted, so nothing it loaded
 * stays in memory or keeps refreshing.
 */
export function SessionGate({ children }: { children: ReactNode }): JSX.Element {
  const status = usePinStatus()
  const gate = useGate()
  const pin = status.data
  const screen = screenFor(pin ?? (status.isLoading ? 'loading' : 'failed'), gate)
  const platform = pin?.platform ?? null

  // Until Sentinel first answers, PINs may be on, so the locks listen already.
  useLockTriggers(pin?.platform !== null)

  // A lock dismisses notices, which sit above everything, before the lock screen fades in. Once the app is gone, so
  // is everything it loaded.
  useEffect(
    () =>
      useGate.subscribe((next, previous) => {
        if (next.epoch !== previous.epoch) {
          toast.dismiss()
        }
        if (next.phase === 'closed' && appMounted(previous.phase)) {
          void forgetApp()
        }
      }),
    [],
  )

  // The app unmounts once the lock screen has faded in, and no later than this. A page in the background, like a closed
  // desktop window, runs its animations slowly or not at all, so don't wait there.
  useEffect(() => {
    if (gate.phase !== 'covering') {
      return
    }
    const timer = setTimeout(finishCovering, document.hidden ? 0 : COVER_LIMIT_MS)
    return (): void => {
      clearTimeout(timer)
    }
  }, [gate.phase])

  const node = ((): ReactNode => {
    switch (screen) {
      case 'loading':
        return <Box position="fixed" inset={0} bg="shades.0" />
      case 'unreachable':
        return (
          <UnreachableScreen
            retrying={status.isFetching}
            onRetry={() => {
              void status.refetch()
            }}
          />
        )
      case 'insecure':
        return <InsecureScreen />
      case 'startos':
        return <StartOsSetupScreen />
      case 'setup':
        // Never on StartOS, which sets the PIN from an action.
        return platform !== null && platform !== 'startos' && <SetupScreen platform={platform} onDone={startReveal} />
      case 'sign-in':
        return platform !== null && <SignInScreen platform={platform} onSignedIn={startReveal} />
      case null:
        return null
    }
  })()

  return (
    <>
      {appMounted(gate.phase) && (
        <motion.div
          aria-hidden={gate.phase === 'open' ? undefined : true}
          initial={false}
          animate={APP_MOTION[gate.phase === 'revealing' ? 'revealing' : gate.phase === 'open' ? 'open' : 'covering']}
        >
          {children}
          {/* After the app, so its effects run once the pages' own have started their requests. */}
          {gate.phase === 'revealing' && <Committed />}
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {screen !== null && (
          <motion.div
            // A fresh sign-in screen for each lock, rather than one still showing its finished check.
            key={screen === 'sign-in' ? `sign-in-${gate.epoch}` : screen}
            // Above the app's sticky header; below dialogs (1400) such as Forgot PIN.
            style={{ position: 'fixed', inset: 0, zIndex: 1300 }}
            {...overlayFade}
            onAnimationComplete={finishCovering}
          >
            <motion.div {...contentFade}>{node}</motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
