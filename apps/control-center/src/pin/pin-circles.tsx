import { Box, HStack, chakra, useToken } from '@chakra-ui/react'
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export const PIN_LENGTH = 6

/** `checking`: Sentinel is checking the PIN; the circles stay as entered. `waiting`: a wrong-PIN delay. */
export type PinCirclesState = 'idle' | 'checking' | 'error' | 'success' | 'waiting'

interface PinCirclesProps {
  value: string
  onChange: (value: string) => void
  /** Called once all six digits are in. */
  onComplete: (pin: string) => void
  state?: PinCirclesState
  /** Increase to shake the circles, as after a wrong PIN. */
  shake?: number
  isDisabled?: boolean
  autoComplete: 'current-password' | 'new-password'
  label: string
  describedBy?: string
}

const MotionHStack = motion(HStack)
const MotionBox = motion(Box)

// A correct PIN: the circles turn green, slide together and shrink into one dot, which becomes the app's
// success check (the one statements and receipts use): a disc scaling up from 80%, then a check drawing in.
const MERGE_DELAY_S = 0.14
const MERGE_S = 0.32
const DISC_AT_S = MERGE_DELAY_S + MERGE_S
const DISC_S = 0.35
const CHECK_DELAY_S = 0.3
const CHECK_S = 0.35
const CHECK_LENGTH = 34
const DISC_SIZE = 60

// How long the correct-PIN animation runs, with a short beat to see the finished check.
const SUCCESS_ANIMATION_MS = Math.round((DISC_AT_S + CHECK_DELAY_S + CHECK_S) * 1000) + 260
const SUCCESS_ANIMATION_REDUCED_MS = 400

/** How long to wait on a correct PIN before moving on, so the check finishes drawing. */
export function successAnimationMs(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? SUCCESS_ANIMATION_REDUCED_MS
    : SUCCESS_ANIMATION_MS
}

/** Anything but digits, spaces and dashes is ignored whole; spaces and dashes are dropped, as in a pasted "123-456". */
export function cleanPinInput(raw: string): string | null {
  if (/[^0-9\s-]/.test(raw)) {
    return null
  }
  const digits = raw.replace(/[\s-]/g, '')
  return digits.length > PIN_LENGTH ? null : digits
}

/**
 * Six round boxes over one real input, so typing, pasting, phones' number pads and password managers all work.
 */
export function PinCircles({
  value,
  onChange,
  onComplete,
  state = 'idle',
  shake = 0,
  isDisabled = false,
  autoComplete,
  label,
  describedBy,
}: PinCirclesProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const row = useAnimationControls()
  const reduceMotion = useReducedMotion() === true
  const [focused, setFocused] = useState(false)
  const [nudge, setNudge] = useState(0)
  const circleRefs = useRef<(HTMLDivElement | null)[]>([])
  const rowRef = useRef<HTMLDivElement>(null)
  // How far each circle slides to meet in the middle, measured when the PIN is accepted.
  const [mergeOffsets, setMergeOffsets] = useState<number[] | null>(null)
  const success = state === 'success'

  useLayoutEffect(() => {
    if (!success) {
      setMergeOffsets(null)
      return
    }
    const rowBox = rowRef.current?.getBoundingClientRect()
    if (!rowBox) {
      return
    }
    const center = rowBox.left + rowBox.width / 2
    setMergeOffsets(
      circleRefs.current.map((circle) => {
        const box = circle?.getBoundingClientRect()
        return box ? center - (box.left + box.width / 2) : 0
      }),
    )
  }, [success])

  useEffect(() => {
    if (shake > 0 && !reduceMotion) {
      void row.start({ x: [0, -8, 8, -8, 8, -4, 4, 0], transition: { duration: 0.42 } })
    }
  }, [shake, row, reduceMotion])

  useEffect(() => {
    if (!isDisabled) {
      inputRef.current?.focus()
    }
  }, [isDisabled])

  const accept = (raw: string): void => {
    const digits = cleanPinInput(raw)
    if (digits === null) {
      setNudge((count) => count + 1)
      return
    }
    onChange(digits)
    if (digits.length === PIN_LENGTH) {
      onComplete(digits)
    }
  }

  return (
    <Box position="relative">
      <MotionHStack
        ref={rowRef}
        spacing={{ base: '9px', sm: '14px' }}
        animate={row}
        aria-hidden="true"
        pointerEvents="none"
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const filled = index < value.length
          const next = focused && index === value.length && state === 'idle' && !isDisabled
          return (
            <MotionBox
              // A new key replays the nudge each time an ignored key lands on the next circle.
              key={next ? `${index}-${nudge}` : index}
              ref={(element: HTMLDivElement | null) => {
                circleRefs.current[index] = element
              }}
              w={{ base: '44px', sm: '52px' }}
              h={{ base: '44px', sm: '52px' }}
              borderRadius="full"
              borderWidth="1.5px"
              borderStyle={state === 'waiting' ? 'dashed' : 'solid'}
              display="grid"
              placeItems="center"
              transitionProperty="border-color, background-color, box-shadow"
              transitionDuration="140ms"
              borderColor={
                state === 'error'
                  ? 'error.700'
                  : success
                    ? 'success.600'
                    : filled || next
                      ? 'neutral.900'
                      : 'neutral.300'
              }
              bg={
                state === 'error'
                  ? 'error.50'
                  : success
                    ? 'success.600'
                    : state === 'waiting'
                      ? 'neutral.100'
                      : 'shades.0'
              }
              boxShadow={next ? '0 0 0 4px rgba(15, 23, 42, 0.07)' : 'none'}
              initial={next && nudge > 0 && !reduceMotion ? { scale: 0.88 } : false}
              animate={
                success && reduceMotion
                  ? { opacity: 0, transition: { duration: 0 } }
                  : success && mergeOffsets
                    ? {
                        x: mergeOffsets[index] ?? 0,
                        scale: 0.55,
                        opacity: [1, 1, 0],
                        transition: {
                          x: { delay: MERGE_DELAY_S, duration: MERGE_S, ease: [0.5, 0, 0.75, 0] },
                          scale: { delay: MERGE_DELAY_S, duration: MERGE_S, ease: [0.5, 0, 0.75, 0] },
                          opacity: { delay: MERGE_DELAY_S, duration: MERGE_S + 0.12, times: [0, 0.73, 1] },
                        },
                      }
                    : { x: 0, scale: 1, opacity: 1, transition: { duration: 0.2 } }
              }
            >
              {filled && (
                <MotionBox
                  // A short tween, not a spring: it settles before a correct PIN's merge begins, however fast the
                  // last digit was typed.
                  initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.12, ease: 'easeOut' }}
                  w="12px"
                  h="12px"
                  borderRadius="full"
                  bg={state === 'error' ? 'error.700' : success ? 'shades.0' : 'neutral.900'}
                />
              )}
            </MotionBox>
          )
        })}
      </MotionHStack>
      {success && <SuccessCheck reduceMotion={reduceMotion} />}
      <chakra.input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={16}
        autoComplete={autoComplete}
        aria-label={label}
        aria-describedby={describedBy}
        disabled={isDisabled}
        value={value}
        onChange={(event) => {
          accept(event.target.value)
        }}
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
        }}
        position="absolute"
        inset="-8px"
        w="calc(100% + 16px)"
        h="calc(100% + 16px)"
        opacity={0}
        border={0}
        p={0}
        m={0}
        cursor="text"
        // 16px keeps iOS from zooming in on focus.
        fontSize="16px"
        color="transparent"
        bg="transparent"
        sx={{ caretColor: 'transparent' }}
      />
    </Box>
  )
}

/** The app's success check, centered where the circles met. */
function SuccessCheck({ reduceMotion }: { reduceMotion: boolean }): JSX.Element {
  const [green] = useToken('colors', ['success.600'])
  const delay = reduceMotion ? 0 : DISC_AT_S
  return (
    <MotionBox
      position="absolute"
      left="50%"
      top="50%"
      w={`${DISC_SIZE}px`}
      h={`${DISC_SIZE}px`}
      ml={`${-DISC_SIZE / 2}px`}
      mt={`${-DISC_SIZE / 2}px`}
      pointerEvents="none"
      aria-hidden="true"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: DISC_S, ease: 'easeOut' }}
    >
      <svg width={DISC_SIZE} height={DISC_SIZE} viewBox={`0 0 ${DISC_SIZE} ${DISC_SIZE}`}>
        <circle cx={DISC_SIZE / 2} cy={DISC_SIZE / 2} r={DISC_SIZE / 2} fill={green} />
        <motion.path
          d="M19 31 L26.5 38.5 L41 23"
          fill="none"
          stroke="white"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECK_LENGTH}
          initial={reduceMotion ? false : { strokeDashoffset: CHECK_LENGTH }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ delay: delay + (reduceMotion ? 0 : CHECK_DELAY_S), duration: CHECK_S, ease: 'easeOut' }}
        />
      </svg>
    </MotionBox>
  )
}
