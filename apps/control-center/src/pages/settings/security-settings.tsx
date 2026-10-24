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
} from '@chakra-ui/react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { type PinOutcome, changePin, confirmPin, signOutEverywhere, usePinStatus } from '../../pin/actions'
import { PinField, useCheckedPin, usePinEntry } from '../../pin/pin-entry'
import { MISMATCH_MESSAGE, SIGN_OUT_FAILED_MESSAGE, UNREACHABLE_MESSAGE, wrongPinMessage } from '../../pin/pin-messages'

/** Shown only where the platform requires a PIN. */
export function SecuritySettings(): JSX.Element | null {
  const { data } = usePinStatus()
  const [changing, setChanging] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const platform = data?.platform ?? null
  if (platform === null) {
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
        {platform !== 'desktop' && (
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

/** Why the dialog went back to the current PIN: Sentinel refused it when changing, or started a delay. */
interface Refusal {
  message: string
  retryAfterMs: number | null
}

type ChangeStep =
  | { step: 'current'; refusal: Refusal | null }
  | { step: 'new'; current: string }
  | { step: 'confirm'; current: string; next: string }

function refusal(outcome: Exclude<PinOutcome, { ok: true }>): Refusal {
  return outcome.reason === 'wait'
    ? { message: '', retryAfterMs: outcome.retryAfterMs }
    : { message: wrongPinMessage(outcome.freeAttemptsLeft), retryAfterMs: outcome.retryAfterMs }
}

function ChangePinDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [change, setChange] = useState<ChangeStep>({ step: 'current', refusal: null })
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
                refusal={change.refusal}
                onAccepted={(current) => {
                  setChange({ step: 'new', current })
                }}
              />
            ) : (
              <NewPinStep
                change={change}
                onStep={setChange}
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

function CurrentPinStep({
  refusal: shown,
  onAccepted,
}: {
  refusal: Refusal | null
  onAccepted: (pin: string) => void
}): JSX.Element {
  // The PIN being checked, read once Sentinel accepts it.
  const checked = useRef('')
  const { view, waitingFor, submit } = useCheckedPin(
    async (pin) => {
      checked.current = pin
      return confirmPin(pin)
    },
    () => {
      onAccepted(checked.current)
    },
    { retryAfterMs: shown?.retryAfterMs ?? null, message: shown?.message ?? '' },
  )
  return (
    <PinField
      view={view}
      label="Current PIN"
      autoComplete="current-password"
      onComplete={submit}
      isDisabled={waitingFor > 0}
    />
  )
}

/** The new PIN, then the same again; one entry across both, so a mismatch message stays until typing. */
function NewPinStep({
  change,
  onStep,
  onChanged,
}: {
  change: Exclude<ChangeStep, { step: 'current' }>
  onStep: (step: ChangeStep) => void
  onChanged: () => void
}): JSX.Element {
  const entry = usePinEntry()
  const backToNew = (): void => {
    onStep({ step: 'new', current: change.current })
  }

  const complete = (pin: string): void => {
    if (change.step === 'new') {
      entry.setValue('')
      onStep({ step: 'confirm', current: change.current, next: pin })
      return
    }
    if (pin !== change.next) {
      void entry.reject(MISMATCH_MESSAGE).then(backToNew)
      return
    }
    entry.setState('checking')
    void changePin(change.current, pin)
      .then(async (outcome) => {
        if (outcome.ok) {
          await entry.accept()
          onChanged()
        } else {
          // The current PIN no longer works, or a wrong-PIN delay is running: say so, from the current PIN.
          onStep({ step: 'current', refusal: refusal(outcome) })
        }
      })
      .catch(async () => {
        entry.setState('idle')
        await entry.reject(UNREACHABLE_MESSAGE)
        backToNew()
      })
  }

  return (
    <PinField
      view={entry}
      label={change.step === 'new' ? 'New PIN, 6 digits' : 'Confirm your new PIN'}
      autoComplete="new-password"
      onComplete={complete}
      circlesKey={change.step}
    />
  )
}
