import {
  Box,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalOverlay,
  SimpleGrid,
  Stack,
  Text,
  VisuallyHidden,
  chakra,
} from '@chakra-ui/react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isDesktop } from '../../mode'
import { PinCircles, type PinCirclesState, successAnimationMs } from '../../pin/pin-circles'
import { MISMATCH_MESSAGE, SIGN_OUT_FAILED_MESSAGE, UNREACHABLE_MESSAGE } from '../../pin/pin-messages'
import { useCheckedPin } from '../../pin/pin-screens'
import { signOutEverywhere, usePinStatus } from '../../pin/status'
import { baseTrpc } from '../../trpc'

/** Shown only where the platform requires a PIN. */
export function SecuritySettings(): JSX.Element | null {
  const { data } = usePinStatus()
  const [changing, setChanging] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  if (data?.required !== true) {
    return null
  }
  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 5, md: 10 }}>
      <Box>
        <Text as="h2" textStyle="text/md" fontWeight="semibold" color="neutral.900">
          Security
        </Text>
        <Text mt={2} textStyle="text/sm" color="neutral.600" maxW="32ch">
          Your PIN locks Control Center when you close it or step away for an hour.
        </Text>
      </Box>
      <HStack spacing={3} align="start">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setChanging(true)
          }}
        >
          Change PIN
        </Button>
        {/* Ends the sessions on every browser and device. The desktop app has only its own window, which the lock
            button already covers. */}
        {!isDesktop && (
          <Button
            size="sm"
            variant="outline"
            isLoading={signingOut}
            onClick={() => {
              setSigningOut(true)
              void signOutEverywhere().then((result) => {
                if (result.isErr()) {
                  setSigningOut(false)
                  toast.error(SIGN_OUT_FAILED_MESSAGE)
                }
              })
            }}
          >
            Sign out everywhere
          </Button>
        )}
      </HStack>
      {changing && (
        <ChangePinDialog
          onClose={() => {
            setChanging(false)
          }}
        />
      )}
    </SimpleGrid>
  )
}

type ChangeStep =
  | { step: 'current' }
  | { step: 'new'; current: string }
  | { step: 'confirm'; current: string; next: string }

function ChangePinDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [change, setChange] = useState<ChangeStep>({ step: 'current' })
  const title = change.step === 'current' ? 'Current PIN' : change.step === 'new' ? 'New PIN' : 'Confirm'
  return (
    <Modal isOpen onClose={onClose} isCentered size="md">
      <ModalOverlay />
      <ModalContent mx={4}>
        <ModalCloseButton />
        <ModalBody py={10}>
          <Stack spacing={8} align="center">
            <Text as="h2" textStyle="text/xl" fontWeight="medium" color="neutral.900">
              {title}
            </Text>
            {change.step === 'current' ? (
              <CurrentPinStep
                onAccepted={(current) => {
                  setChange({ step: 'new', current })
                }}
              />
            ) : (
              <NewPinStep
                key={change.step}
                change={change}
                onChosen={(next) => {
                  if (change.step === 'new') {
                    setChange({ step: 'confirm', current: change.current, next })
                  }
                }}
                onMismatch={() => {
                  setChange({ step: 'new', current: change.current })
                }}
                onChanged={() => {
                  toast.success('PIN changed')
                  onClose()
                }}
              />
            )}
          </Stack>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

function CurrentPinStep({ onAccepted }: { onAccepted: (pin: string) => void }): JSX.Element {
  const messageId = useId()
  // The PIN being checked, read once Sentinel accepts it.
  const checked = useRef('')
  const { entry, waitingFor, submit } = useCheckedPin(
    async (pin) => {
      checked.current = pin
      return baseTrpc.auth.confirmPin.mutate({ pin })
    },
    () => {
      onAccepted(checked.current)
    },
    null,
  )
  return (
    <>
      <PinCircles
        value={entry.value}
        onChange={entry.setValue}
        onComplete={submit}
        state={entry.state === 'waiting' && waitingFor === 0 ? 'idle' : entry.state}
        shake={entry.shake}
        isDisabled={waitingFor > 0}
        autoComplete="current-password"
        label="Current PIN"
        describedBy={messageId}
      />
      <StepMessage id={messageId} message={entry.message} isError={entry.isError} />
    </>
  )
}

function NewPinStep({
  change,
  onChosen,
  onMismatch,
  onChanged,
}: {
  change: Exclude<ChangeStep, { step: 'current' }>
  onChosen: (pin: string) => void
  onMismatch: () => void
  onChanged: () => void
}): JSX.Element {
  const messageId = useId()
  const [value, setValue] = useState('')
  const [state, setState] = useState<PinCirclesState>('idle')
  const [shake, setShake] = useState(0)
  const [message, setMessage] = useState('')

  const reject = (text: string, then: () => void): void => {
    setState('error')
    setShake((count) => count + 1)
    setMessage(text)
    setTimeout(() => {
      setValue('')
      setState('idle')
      then()
    }, 560)
  }

  const complete = (pin: string): void => {
    if (change.step === 'new') {
      onChosen(pin)
      return
    }
    if (pin !== change.next) {
      reject(MISMATCH_MESSAGE, onMismatch)
      return
    }
    setState('checking')
    void baseTrpc.auth.changePin
      .mutate({ currentPin: change.current, newPin: pin })
      .then((outcome) => {
        if (outcome.ok) {
          setState('success')
          setTimeout(onChanged, successAnimationMs())
        } else {
          reject(UNREACHABLE_MESSAGE, onMismatch)
        }
      })
      .catch(() => {
        reject(UNREACHABLE_MESSAGE, onMismatch)
      })
  }

  return (
    <chakra.form
      onSubmit={(event) => {
        event.preventDefault()
      }}
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap={8}
    >
      <VisuallyHidden>
        <input type="text" name="username" autoComplete="username" value="Bitcoin Control Center" readOnly />
      </VisuallyHidden>
      <PinCircles
        value={value}
        onChange={(next) => {
          if (next.length > 0) {
            setMessage('')
          }
          setValue(next)
        }}
        onComplete={complete}
        state={state}
        shake={shake}
        autoComplete="new-password"
        label={change.step === 'new' ? 'New PIN, 6 digits' : 'Confirm your new PIN'}
        describedBy={messageId}
      />
      <StepMessage id={messageId} message={message} isError={message !== ''} />
    </chakra.form>
  )
}

function StepMessage({ id, message, isError }: { id: string; message: string; isError: boolean }): JSX.Element {
  return (
    <Text
      id={id}
      aria-live="polite"
      minH="22px"
      mt={-4}
      textStyle="text/sm"
      textAlign="center"
      color={isError ? 'error.700' : 'neutral.600'}
    >
      {message}
    </Text>
  )
}
