import { Box } from '@chakra-ui/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { AnimatePresence, type HTMLMotionProps, motion } from 'framer-motion'
import { type ReactNode, useEffect } from 'react'
import { toast } from 'sonner'
import { clearFlowSource } from '../lib/flow-tracker'
import { baseTrpc, queryClient } from '../trpc'
import {
  PIN_STATUS_KEY,
  type PinStatus,
  forgetLoadedData,
  lockApp,
  refreshPinStatus,
  setPinStatus,
  usePinStatus,
} from './actions'
import { HttpsRequiredScreen, SetupScreen, SignInScreen, StartOsSetupScreen, UnreachableScreen } from './pin-screens'
import { type AppPhase, isCurrent, useGate } from './session'

/** Matches Sentinel's idle limit; the server ends the session either way. */
const IDLE_LIMIT_MS = 60 * 60 * 1000
// Real use is reported at most this often; the server needs only a rough time.
const ACTIVITY_REPORT_MS = 60 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

/** Keeps the session open while someone uses the app, and locks it after an hour without use. */
function ActivityTracker(): null {
  useEffect(() => {
    let lastActive = Date.now()
    let lastReported = 0
    const onActivity = (): void => {
      lastActive = Date.now()
      if (lastActive - lastReported >= ACTIVITY_REPORT_MS) {
        lastReported = lastActive
        void baseTrpc.auth.touch.mutate().catch(() => undefined)
      }
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true })
    }
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActive > IDLE_LIMIT_MS) {
        void lockApp()
      }
    }, 30 * 1000)
    return (): void => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity)
      }
      clearInterval(idleCheck)
    }
  }, [])
  return null
}

/**
 * The desktop app locks when its window closes, or the computer sleeps or its screen locks. This listens at every
 * stage, including setup and the reveal, since a tab signs in before the app opens.
 */
function DesktopLock(): null {
  useEffect(
    () =>
      window.desktop?.pin?.onLock(() => {
        void lockApp()
      }),
    [],
  )
  return null
}

/**
 * A page the browser keeps in memory and brings back on Back or Forward comes back exactly as it was left, so it
 * locks at once, with no fade: leaving the page counts as closing it.
 */
function RestoredPageLock(): null {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        void lockApp(true)
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return (): void => {
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])
  return null
}

// Leaving, the lock screen fades through white: its content (the check) shrinks slightly and fades first, then
// the blank screen gives way as the app fades in and settles into place.
const CONTENT_OUT_S = 0.25
const REVEAL_S = 0.45
const REVEAL_EASE = [0.4, 0, 0.2, 1] as const
// The lock screen takes 0.25s to fade in over the app; unmount the app by this time even if that fade stalls.
const COVER_LIMIT_MS = 400
// How long the finished check may wait for the app to mount and load its first data, so loading states don't pop in after the fade.
// Home's first overview can take over half a second while Sentinel fetches the price.
const SETTLE_LIMIT_MS = 1500

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
const appUnderLock = { opacity: 0, y: 8 }
const appShown = { opacity: 1, y: 0, transition: { delay: CONTENT_OUT_S, duration: REVEAL_S, ease: REVEAL_EASE } }
const appCovered = { opacity: 0, transition: { duration: 0.25 } }

// Pages can start more requests a render or two after mounting, so the app counts as settled only once nothing
// has been loading for this long.
const QUIET_MS = 100

/** Waits for the app's first requests, up to a limit. */
async function settled(start: number): Promise<void> {
  let quietSince = performance.now()
  while (performance.now() - start < SETTLE_LIMIT_MS) {
    if (queryClient.isFetching() > 0) {
      quietSince = performance.now()
    } else if (performance.now() - quietSince >= QUIET_MS) {
      return
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }
}

/** Waits for the browser to paint twice, so work just scheduled (like mounting the app) is on screen. */
async function afterPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

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
 * Opens the app after a sign-in from lock epoch `epoch`. The app renders underneath the finished check first, so
 * the check animates on an idle page and the lock screen fades away over an app that's already drawn. A lock
 * meanwhile closes the app and voids the reveal.
 */
async function reveal(epoch: number): Promise<void> {
  if (!isCurrent(epoch)) {
    return
  }
  const start = performance.now()
  // A large first render can take longer than a few frames.
  const committed = new Promise<void>((resolve) => {
    onCommitted = resolve
    setTimeout(resolve, SETTLE_LIMIT_MS)
  })
  useGate.setState({ app: 'revealing' })
  await committed
  await afterPaint()
  await settled(start)
  if (!isCurrent(epoch)) {
    return
  }
  // Sentinel signed this tab in when it accepted the PIN; a status check from before then mustn't undo that.
  await queryClient.cancelQueries({ queryKey: PIN_STATUS_KEY })
  setPinStatus({ pinSet: true, signedIn: true, retryAfterMs: null })
  useGate.setState({ app: 'open', setupEpoch: null })
}

function finishCovering(): void {
  if (useGate.getState().app === 'covering') {
    useGate.setState({ app: 'closed' })
  }
}

/** The PIN screen for where the app stands, or null when the app is open. */
function pinScreen(
  status: UseQueryResult<PinStatus>,
  app: AppPhase,
  epoch: number,
  settingUp: boolean,
): { key: string; node: ReactNode } | null {
  const pin = status.data
  if (status.isLoading) {
    return { key: 'loading', node: <Box position="fixed" inset={0} bg="shades.0" /> }
  }
  if (!pin) {
    // Without an answer, it's unknown whether a PIN is needed, so the app stays closed until Sentinel replies.
    const retry = (): void => {
      void status.refetch()
    }
    return { key: 'unreachable', node: <UnreachableScreen retrying={status.isFetching} onRetry={retry} /> }
  }
  if (pin.platform === null || app === 'open') {
    return null
  }
  if (settingUp || (!pin.pinSet && pin.inAppSetup && !pin.insecure)) {
    const done = (): void => {
      void reveal(useGate.getState().epoch)
    }
    return { key: 'setup', node: <SetupScreen platform={pin.platform} onDone={done} /> }
  }
  if (pin.insecure) {
    return { key: 'https', node: <HttpsRequiredScreen /> }
  }
  if (!pin.pinSet) {
    return { key: 'startos-setup', node: <StartOsSetupScreen /> }
  }
  // Each lock gets a fresh sign-in screen, not one still fading out with its finished check.
  const signedIn = (from: number): void => {
    void reveal(from)
  }
  return {
    key: `sign-in-${epoch}`,
    node: <SignInScreen platform={pin.platform} retryAfterMs={pin.retryAfterMs} onSignedIn={signedIn} />,
  }
}

/**
 * Shows the PIN screens until this tab is signed in. Behind a lock screen the app isn't mounted, so nothing it
 * loaded stays in memory or keeps refreshing.
 */
export function SessionGate({ children }: { children: ReactNode }): JSX.Element {
  const status = usePinStatus()
  const { epoch, app: storedApp, setupEpoch } = useGate()
  const pin = status.data
  // Sentinel's first answer decides whether the app opens; after that, only a sign-in or a lock moves it.
  const app: AppPhase =
    storedApp === 'checking' && pin ? (pin.platform === null || pin.signedIn ? 'open' : 'closed') : storedApp
  useEffect(() => {
    if (storedApp === 'checking' && app !== 'checking') {
      useGate.setState({ app })
    }
  }, [storedApp, app])

  // Sentinel ended this tab's session while the app was open (an hour idle, say): lock.
  const signedOut = pin !== undefined && pin.platform !== null && !pin.signedIn
  useEffect(() => {
    if (app === 'open' && signedOut) {
      void lockApp()
    }
  }, [app, signedOut])

  // A lock clears notices, which sit above everything; the app's data goes once it has left the screen.
  useEffect(
    () =>
      useGate.subscribe((next, previous) => {
        if (next.epoch !== previous.epoch) {
          toast.dismiss()
        }
        if (next.app === 'closed' && ['revealing', 'open', 'covering'].includes(previous.app)) {
          toast.dismiss()
          clearFlowSource()
          void forgetLoadedData().then(refreshPinStatus)
        }
      }),
    [],
  )

  // The app unmounts once the lock screen has faded in, and no later than this. A page in the background runs its
  // animations slowly or not at all, and the idle lock usually fires when nobody is looking, so don't wait there.
  useEffect(() => {
    if (app !== 'covering') {
      return
    }
    const timer = setTimeout(finishCovering, document.hidden ? 0 : COVER_LIMIT_MS)
    return (): void => {
      clearTimeout(timer)
    }
  }, [app])

  const screen = pinScreen(status, app, epoch, setupEpoch === epoch)
  const pinsOn = pin !== undefined && pin.platform !== null

  return (
    <>
      {(app === 'revealing' || app === 'open' || app === 'covering') && (
        <motion.div
          aria-hidden={screen ? true : undefined}
          initial={false}
          animate={app === 'open' ? appShown : app === 'revealing' ? appUnderLock : appCovered}
        >
          {children}
          {/* After the app, so its effects run once the pages' own have started their requests. */}
          {app === 'revealing' && <Committed />}
          {pinsOn && app === 'open' && <ActivityTracker />}
        </motion.div>
      )}
      {pinsOn && <DesktopLock />}
      {pinsOn && <RestoredPageLock />}
      <AnimatePresence initial={false}>
        {screen && (
          <motion.div
            key={screen.key}
            // Above the app's sticky header; below dialogs (1400) such as Forgot PIN.
            style={{ position: 'fixed', inset: 0, zIndex: 1300 }}
            {...overlayFade}
            onAnimationComplete={finishCovering}
          >
            <motion.div {...contentFade}>{screen.node}</motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
