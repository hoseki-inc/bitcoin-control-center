import { Text, VisuallyHidden, chakra } from '@chakra-ui/react'
import { useEffect, useId, useState } from 'react'
import { type PinOutcome, refreshPinStatus, setRetryAt, usePinStatus } from './actions'
import { currentEpoch } from './gate'
import { PinCircles, type PinCirclesState, successAnimationMs } from './pin-circles'

export const MISMATCH_MESSAGE = 'Those PINs didn’t match. Choose your PIN again.'
const UNREACHABLE_MESSAGE = 'Couldn’t reach Control Center. Try again.'
// Long enough to see the circles shake red before the next try.
const FEEDBACK_MS = 560

function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
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
   * Has Sentinel check the PIN: the success check on `accepted`; the wrong-PIN message or delay on `refused`; on
   * `unreachable`, a message, and the status asked again in case the PIN changed meanwhile.
   */
  check: (request: () => Promise<PinOutcome>) => Promise<CheckResult>
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

  const check = async (request: () => Promise<PinOutcome>): Promise<CheckResult> => {
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
      setState('success')
      setMessage('')
      await settle(wait(successAnimationMs()))
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
  stepKey,
}: {
  field: PinField
  label: string
  autoComplete: 'current-password' | 'new-password'
  onComplete: (pin: string) => void
  checksPin?: boolean
  /** A new key per step, so each step starts with fresh circles. */
  stepKey?: string
}): JSX.Element {
  const messageId = useId()
  const waitLeft = useWaitLeft(checksPin)
  const waiting = waitLeft > 0 && field.state === 'idle'
  const message = waiting ? `Too many wrong PINs. Try again in ${formatWait(waitLeft)}.` : field.message
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
          key={stepKey}
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
        color={waiting || message === '' ? 'neutral.600' : 'error.700'}
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {message}
      </Text>
    </>
  )
}
