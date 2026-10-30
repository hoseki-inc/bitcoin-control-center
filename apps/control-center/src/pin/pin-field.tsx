import { Box, Stack, Text, VisuallyHidden, chakra } from '@chakra-ui/react'
import { AnimatePresence, useReducedMotion } from 'framer-motion'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { FADE_TURN, StepLayer, TEXT_TURN, TEXT_TURN_AFTER_EXIT } from '../components/onboarding/onboarding-takeover'
import { type PinOutcome, refreshPinStatus, setRetryAt, usePinStatus } from './actions'
import { currentEpoch } from './gate'
import { PinCircles, type PinCirclesState, successAnimationMs } from './pin-circles'

export const MISMATCH_MESSAGE = 'Those PINs didn’t match. Choose your PIN again.'
const UNREACHABLE_MESSAGE = 'Couldn’t reach Control Center. Try again.'
// Long enough to see the dots shake red before the next try.
const FEEDBACK_MS = 480

function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  }
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function wrongPinMessage(freeAttemptsLeft: number): string {
  if (freeAttemptsLeft > 0 && freeAttemptsLeft <= 2) {
    return `Wrong PIN. ${freeAttemptsLeft} more ${freeAttemptsLeft === 1 ? 'try' : 'tries'} before a short wait.`
  }
  return 'Wrong PIN. Try again.'
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// A PIN check that a lock overtook never settles, so nothing after it (opening the app, a notice) happens.
const NEVER = new Promise<never>(() => undefined)

export type CheckResult = 'accepted' | 'refused' | 'unreachable'

export interface PinField {
  value: string
  state: Exclude<PinCirclesState, 'waiting'>
  message: string
  onChange: (value: string) => void
  clear: () => void
  /** Shakes red with the message, then clears for another try. The message stays until typing. */
  reject: (message: string) => Promise<void>
  /**
   * Has Sentinel check the PIN: the success check on `accepted`, unless `celebrate` is off because nothing has been
   * done yet; the wrong-PIN message or delay on `refused`; on `unreachable`, a message, and the status asked again in
   * case the PIN changed meanwhile.
   */
  check: (request: () => Promise<PinOutcome>, options?: { celebrate?: boolean }) => Promise<CheckResult>
}

/** One PIN entry, shared by sign-in, setup and Change PIN. */
export function usePinField(): PinField {
  const [value, setValue] = useState('')
  const [state, setState] = useState<PinField['state']>('idle')
  const [message, setMessage] = useState('')

  const reject = async (text: string): Promise<void> => {
    setState('error')
    setMessage(text)
    await wait(FEEDBACK_MS)
    setValue('')
    setState('idle')
  }

  const check: PinField['check'] = async (request, { celebrate = true } = {}) => {
    const epoch = currentEpoch()
    const settle = async <T,>(promise: Promise<T>): Promise<T> => {
      const result = await promise
      return currentEpoch() === epoch ? result : NEVER
    }
    setState('checking')
    const outcome = await settle(request().catch(() => null))
    if (outcome === null) {
      setState('idle')
      await settle(reject(UNREACHABLE_MESSAGE))
      void refreshPinStatus()
      return 'unreachable'
    }
    if (outcome.ok) {
      setMessage('')
      if (celebrate) {
        setState('success')
        await settle(wait(successAnimationMs()))
      }
      return 'accepted'
    }
    if (outcome.reason === 'wrong') {
      await settle(reject(wrongPinMessage(outcome.freeAttemptsLeft)))
    }
    if (outcome.retryAfterMs !== null) {
      setValue('')
      setMessage('')
      setState('idle')
      setRetryAt(outcome.retryAfterMs)
    }
    return 'refused'
  }

  return {
    value,
    state,
    message,
    onChange: (next) => {
      if (next !== '') {
        setMessage('')
      }
      setValue(next)
    },
    clear: () => {
      setValue('')
      setState('idle')
    },
    reject,
    check,
  }
}

/**
 * Steps turning over in one grid cell, as the introduction's do. The first step just appears. That's set on the step
 * rather than with AnimatePresence's `initial`, which would also stop anything that appears inside it later, such as the
 * success check, from animating in.
 */
export function PinSteps({
  step,
  direction,
  afterExit = false,
  children,
}: {
  step: string
  /** 1 going forward, -1 going back. */
  direction: number
  /** Holds this step back until the last has gone. Only for a step with no PIN field, which must be ready at once. */
  afterExit?: boolean
  children: ReactNode
}): JSX.Element {
  const turn = useReducedMotion() === true ? FADE_TURN : afterExit ? TEXT_TURN_AFTER_EXIT : TEXT_TURN
  const appeared = useRef(false)
  useEffect(() => {
    appeared.current = true
  }, [])
  return (
    <Box display="grid">
      <AnimatePresence custom={direction}>
        <StepLayer
          key={step}
          custom={direction}
          variants={turn}
          initial={appeared.current ? 'enter' : false}
          gridArea="1 / 1"
          minW={0}
        >
          {children}
        </StepLayer>
      </AnimatePresence>
    </Box>
  )
}

/** Time left in the wrong-PIN delay, ticking while it runs; zero once it passes. */
function useWaitLeft(counts: boolean): number {
  const status = usePinStatus().data
  const until = counts && status !== undefined && status.platform !== null ? status.retryAt : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 250)
    return (): void => {
      clearInterval(timer)
    }
  }, [until])
  return until === null ? 0 : Math.max(0, until - now)
}

/** What a screen reader hears. Only a wait's start and end: its visible countdown would repeat every second. */
function useAnnouncement(field: PinField, waiting: boolean): string {
  const wasWaiting = useRef(false)
  const [waitEnded, setWaitEnded] = useState(false)
  useEffect(() => {
    setWaitEnded(wasWaiting.current && !waiting)
    wasWaiting.current = waiting
  }, [waiting])
  if (waiting) {
    return 'Too many wrong PINs. You can try again when the wait ends.'
  }
  if (field.state === 'success') {
    return 'PIN accepted.'
  }
  return field.message !== '' || !waitEnded || field.value !== '' ? field.message : 'You can enter your PIN again.'
}

/**
 * The PIN circles in a form password managers recognize, with the message under them. A field that checks the PIN
 * against Sentinel shows its wrong-PIN delay, during which it takes nothing.
 */
export function PinInput({
  field,
  label,
  autoComplete,
  onComplete,
  checksPin = false,
  descriptionId,
}: {
  field: PinField
  label: string
  autoComplete: 'current-password' | 'new-password'
  onComplete: (pin: string) => void
  checksPin?: boolean
  /** The screen's description, which focus would otherwise skip past. */
  descriptionId?: string
}): JSX.Element {
  const messageId = useId()
  const waitLeft = useWaitLeft(checksPin)
  const waiting = waitLeft > 0 && field.state === 'idle'
  const message = waiting ? `Too many wrong PINs. Try again in ${formatWait(waitLeft)}.` : field.message
  const announcement = useAnnouncement(field, waiting)
  return (
    <Stack spacing={3}>
      <chakra.form
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        <VisuallyHidden>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value="Bitcoin Control Center"
            readOnly
            tabIndex={-1}
          />
        </VisuallyHidden>
        <PinCircles
          value={field.value}
          onChange={field.onChange}
          onComplete={(pin) => {
            if (field.state === 'idle' && !waiting) {
              onComplete(pin)
            }
          }}
          state={waiting ? 'waiting' : field.state}
          autoComplete={autoComplete}
          label={label}
          describedBy={descriptionId === undefined ? messageId : `${descriptionId} ${messageId}`}
        />
      </chakra.form>
      <Text
        id={messageId}
        minH="20px"
        textStyle="text/sm"
        color={waiting || message === '' ? 'neutral.600' : 'error.700'}
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {message}
      </Text>
      <VisuallyHidden aria-live="polite">{announcement}</VisuallyHidden>
    </Stack>
  )
}
