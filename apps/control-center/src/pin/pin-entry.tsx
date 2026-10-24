import { Text, VisuallyHidden, chakra } from '@chakra-ui/react'
import { useEffect, useId, useState } from 'react'
import { type PinOutcome, refreshPinStatus } from './actions'
import { PinCircles, type PinCirclesState, successAnimationMs } from './pin-circles'
import { UNREACHABLE_MESSAGE, waitMessage, wrongPinMessage } from './pin-messages'
import { currentEpoch } from './session'

// Long enough to see the circles shake red before the next try.
const FEEDBACK_MS = 560

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Milliseconds left until `until`, ticking while it runs; zero once it passes. */
function useTimeLeft(until: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) {
      return
    }
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 250)
    return (): void => {
      clearInterval(timer)
    }
  }, [until])
  return until === null ? 0 : Math.max(0, until - now)
}

/** What a PIN field shows. */
export interface PinView {
  value: string
  setValue: (value: string) => void
  state: PinCirclesState
  shake: number
  message: string
  isError: boolean
}

export interface PinEntry extends PinView {
  setState: (state: PinCirclesState) => void
  showMessage: (message: string, isError: boolean) => void
  /** Shakes red and shows the message, then clears the circles for another try; the message stays until typing. */
  reject: (message: string) => Promise<void>
  /** Draws the check, and resolves once it has finished. */
  accept: () => Promise<void>
}

export function usePinEntry(initialMessage = ''): PinEntry {
  const [value, setValue] = useState('')
  const [state, setState] = useState<PinCirclesState>('idle')
  const [shake, setShake] = useState(0)
  const [message, setMessage] = useState(initialMessage)
  const [isError, setIsError] = useState(initialMessage !== '')
  return {
    value,
    setValue: (next) => {
      if (next.length > 0 && isError) {
        setMessage('')
        setIsError(false)
      }
      setValue(next)
    },
    state,
    setState,
    shake,
    message,
    isError,
    showMessage: (text, error) => {
      setMessage(text)
      setIsError(error)
    },
    reject: async (text) => {
      setState('error')
      setShake((count) => count + 1)
      setMessage(text)
      setIsError(true)
      await wait(FEEDBACK_MS)
      setValue('')
      setState('idle')
    },
    accept: async () => {
      setState('success')
      setMessage('')
      await wait(successAnimationMs())
    },
  }
}

export interface CheckedPin {
  view: PinView
  /** Time left in a wrong-PIN delay; the circles are disabled while it runs. */
  waitingFor: number
  submit: (pin: string) => void
}

/**
 * A PIN Sentinel checks, with its wrong-PIN messages and delays: sign-in and Change PIN's current PIN.
 * `onAccepted` gets the lock epoch from when the PIN was entered, once the check has drawn.
 */
export function useCheckedPin(
  check: (pin: string) => Promise<PinOutcome>,
  onAccepted: (epoch: number) => void,
  { retryAfterMs = null, message = '' }: { retryAfterMs?: number | null; message?: string } = {},
): CheckedPin {
  const entry = usePinEntry(message)
  const [retryAt, setRetryAt] = useState<number | null>(() =>
    retryAfterMs === null ? null : Date.now() + retryAfterMs,
  )
  const waitingFor = useTimeLeft(retryAt)

  const startDelay = (ms: number): void => {
    entry.setValue('')
    entry.showMessage('', false)
    setRetryAt(Date.now() + ms)
  }

  const submit = (pin: string): void => {
    if (entry.state !== 'idle' || waitingFor > 0) {
      return
    }
    entry.setState('checking')
    const epoch = currentEpoch()
    void check(pin)
      .then(async (outcome) => {
        if (outcome.ok) {
          await entry.accept()
          onAccepted(epoch)
          return
        }
        entry.setState('idle')
        if (outcome.reason === 'wait') {
          startDelay(outcome.retryAfterMs)
          return
        }
        await entry.reject(wrongPinMessage(outcome.freeAttemptsLeft))
        if (outcome.retryAfterMs !== null) {
          startDelay(outcome.retryAfterMs)
        }
      })
      .catch(async () => {
        entry.setState('idle')
        await entry.reject(UNREACHABLE_MESSAGE)
        // The PIN may have been cleared meanwhile; asking again moves to the right screen.
        void refreshPinStatus()
      })
  }

  const waiting = waitingFor > 0
  return {
    view: {
      ...entry,
      state: waiting ? 'waiting' : entry.state,
      message: waiting ? waitMessage(waitingFor) : entry.message,
      isError: !waiting && entry.isError,
    },
    waitingFor,
    submit,
  }
}

/**
 * The PIN circles and their message. The form names the app as the "username", so a password manager can save
 * and fill the PIN.
 */
export function PinField({
  view,
  label,
  autoComplete,
  onComplete,
  isDisabled = false,
  circlesKey,
}: {
  view: PinView
  label: string
  autoComplete: 'current-password' | 'new-password'
  onComplete: (pin: string) => void
  isDisabled?: boolean
  /** A new key gives fresh circles, as for each setup step. */
  circlesKey?: string
}): JSX.Element {
  const messageId = useId()
  return (
    <>
      <chakra.form
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        <VisuallyHidden>
          <input type="text" name="username" autoComplete="username" value="Bitcoin Control Center" readOnly />
        </VisuallyHidden>
        <PinCircles
          key={circlesKey}
          value={view.value}
          onChange={view.setValue}
          onComplete={onComplete}
          state={view.state}
          shake={view.shake}
          isDisabled={isDisabled}
          autoComplete={autoComplete}
          label={label}
          describedBy={messageId}
        />
      </chakra.form>
      <Text
        id={messageId}
        aria-live="polite"
        minH="22px"
        mt={-4}
        textStyle="text/sm"
        textAlign="center"
        color={view.isError ? 'error.700' : 'neutral.600'}
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {view.message}
      </Text>
    </>
  )
}
