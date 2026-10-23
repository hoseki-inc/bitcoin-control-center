import { Box } from '@chakra-ui/react'
import { AnimatePresence, type HTMLMotionProps, motion } from 'framer-motion'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { clearFlowSource } from '../lib/flow-tracker'
import { baseTrpc, queryClient } from '../trpc'
import { HttpsRequiredScreen, SetupScreen, SignInScreen, StartOsSetupScreen, UnreachableScreen } from './pin-screens'
import { useLockState } from './session'
import { PIN_STATUS_KEY, type PinStatus, forgetLoadedData, lockApp, usePinStatus } from './status'

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
/**
 * A page the browser keeps in memory and brings back on Back or Forward comes back exactly as it was left, so it
 * locks: leaving the page counts as closing it.
 */
function RestoredPageLock(): null {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        void lockApp()
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return (): void => {
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])
  return null
}

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

/** Reports when the app's first render has committed, after its own effects have started its requests. */
function Committed({ onCommit }: { onCommit: () => void }): null {
  useEffect(() => {
    onCommit()
  }, [onCommit])
  return null
}

/**
 * `locked`: only the lock screen is mounted. `revealing`: signed in; the app renders underneath the finished
 * check, then the lock screen fades away. `open`: the app alone. `covering`: the lock screen is fading in over
 * the app, which unmounts once it's covered.
 */
type GatePhase = 'locked' | 'revealing' | 'open' | 'covering'

/**
 * Shows the PIN screens until this tab is signed in. Behind a lock screen the app isn't mounted, so nothing it
 * loaded stays in memory or keeps refreshing. Signing in, the app renders underneath the finished check first, so
 * the check animates on an idle page and the lock screen fades away over an app that's already drawn.
 */
export function SessionGate({ children }: { children: ReactNode }): JSX.Element {
  const status = usePinStatus()
  const locked = useLockState((state) => state.locked)
  const unlock = useLockState((state) => state.unlock)
  // Stays on setup through the save step, even after Sentinel reports the PIN as set.
  const [settingUp, setSettingUp] = useState(false)
  const [phase, setPhase] = useState<GatePhase>('locked')
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // Resolves the reveal's wait for the app to mount. A large first render can take longer than a few frames.
  const commitRef = useRef<(() => void) | null>(null)
  const onCommit = useCallback((): void => {
    commitRef.current?.()
    commitRef.current = null
  }, [])

  // A new sign-in screen after a cancelled reveal, rather than the one still showing its finished check.
  const [signInKey, setSignInKey] = useState(0)

  // The app leaves the screen: unmounted, its data dropped, and the PIN status asked again.
  const closeApp = useCallback((): void => {
    phaseRef.current = 'locked'
    setPhase('locked')
    clearFlowSource()
    void forgetLoadedData().then(async () => queryClient.invalidateQueries({ queryKey: PIN_STATUS_KEY }))
  }, [])

  // A lock while setup or a sign-in is finishing wins: the PIN is set, but this tab is signed out.
  const cancelSignIn = (): void => {
    queryClient.setQueryData<PinStatus>(PIN_STATUS_KEY, (current) =>
      current ? { ...current, pinSet: true, signedIn: false } : current,
    )
    setSettingUp(false)
    setSignInKey((key) => key + 1)
    closeApp()
  }

  // Setup signs the tab in before its Save step, so a lock there ends setup.
  const locks = useLockState((state) => state.locks)
  const locksSeen = useRef(locks)
  useEffect(() => {
    if (locks === locksSeen.current) {
      return
    }
    locksSeen.current = locks
    if (settingUp && phaseRef.current === 'locked') {
      cancelSignIn()
    }
  })

  // Counted from when the PIN was entered, so a lock during the sign-in's finishing check also counts.
  const reveal = (locksAtStart = useLockState.getState().locks): void => {
    const start = performance.now()
    const committed = new Promise<void>((resolve) => {
      commitRef.current = resolve
      setTimeout(resolve, SETTLE_LIMIT_MS)
    })
    setPhase('revealing')
    void committed
      .then(afterPaint)
      .then(async () => settled(start))
      .then(() => {
        if (useLockState.getState().locks !== locksAtStart) {
          cancelSignIn()
          return
        }
        // Sentinel signed this tab in when it accepted the PIN; record that here rather than wait to ask again.
        queryClient.setQueryData<PinStatus>(PIN_STATUS_KEY, (current) =>
          current ? { ...current, pinSet: true, signedIn: true, retryAfterMs: null } : current,
        )
        setSettingUp(false)
        unlock()
        setPhase('open')
      })
  }

  const pin = status.data
  let screen: { key: string; node: ReactNode } | null = null
  if (status.isLoading) {
    screen = { key: 'loading', node: <Box position="fixed" inset={0} bg="shades.0" /> }
  } else if (!pin) {
    // Without an answer, it's unknown whether a PIN is needed, so the app stays closed until Sentinel replies.
    screen = {
      key: 'unreachable',
      node: (
        <UnreachableScreen
          retrying={status.isFetching}
          onRetry={() => {
            void status.refetch()
          }}
        />
      ),
    }
  } else if (!pin.required) {
    // PINs are off on this platform.
    screen = null
  } else if (settingUp || (!pin.pinSet && pin.inAppSetup && !pin.needsHttps)) {
    screen = {
      key: 'setup',
      node: (
        <SetupScreen
          recovery={pin.recovery}
          onPinSet={() => {
            setSettingUp(true)
          }}
          onDone={() => {
            reveal()
          }}
          onLocked={cancelSignIn}
        />
      ),
    }
  } else if (pin.needsHttps) {
    screen = { key: 'https', node: <HttpsRequiredScreen /> }
  } else if (!pin.pinSet) {
    screen = { key: 'startos-setup', node: <StartOsSetupScreen /> }
  } else if (!pin.signedIn || locked || phase === 'revealing') {
    // While revealing, the app's own status check can report this tab signed in before the reveal has waited for
    // the app's data; the lock screen stays until the reveal finishes.
    screen = {
      key: `sign-in-${signInKey}`,
      node: <SignInScreen recovery={pin.recovery} retryAfterMs={pin.retryAfterMs} onSignedIn={reveal} />,
    }
  }

  const covered = screen !== null
  useEffect(() => {
    if (!covered) {
      setPhase('open')
    } else if (phase === 'open') {
      setPhase('covering')
    }
  }, [covered, phase])

  // Read by the timer and the fade's completion, whichever comes first.
  const finishCovering = useCallback((): void => {
    if (phaseRef.current === 'covering') {
      closeApp()
    }
  }, [closeApp])

  // The app unmounts once the lock screen has faded in, and no later than this. A page in the background runs its
  // animations slowly or not at all, and the idle lock usually fires when nobody is looking, so don't wait there.
  useEffect(() => {
    if (phase !== 'covering') {
      return
    }
    const timer = setTimeout(finishCovering, document.hidden ? 0 : COVER_LIMIT_MS)
    return (): void => {
      clearTimeout(timer)
    }
  }, [phase, finishCovering])

  // In the render where the lock screen first appears over the app, the phase is still `open`.
  const appMounted = !covered || phase !== 'locked'

  return (
    <>
      {appMounted && (
        <motion.div
          aria-hidden={covered ? true : undefined}
          initial={false}
          animate={!covered ? appShown : phase === 'revealing' ? appUnderLock : appCovered}
        >
          {children}
          {/* After the app, so its effects run once the pages' own have started their requests. */}
          {phase === 'revealing' && <Committed onCommit={onCommit} />}
          {pin?.required === true && !covered && <ActivityTracker />}
        </motion.div>
      )}
      {pin?.required === true && <DesktopLock />}
      {pin?.required === true && <RestoredPageLock />}
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
