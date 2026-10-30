import {
  Box,
  Button,
  Flex,
  HStack,
  Modal,
  ModalCloseButton,
  ModalContent,
  ModalOverlay,
  SimpleGrid,
  Text,
  VisuallyHidden,
} from '@chakra-ui/react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { StepTitle } from '../../components/onboarding/onboarding-takeover'
import { StepDots } from '../../components/onboarding/step-dots'
import { signOutEverywhere, usePinStatus } from '../../pin/actions'
import { MISMATCH_MESSAGE, PinInput, PinSteps, usePinField } from '../../pin/pin-field'
import { baseTrpc } from '../../trpc'

/** Shown only where the platform requires a PIN. */
export function SecuritySettings(): JSX.Element | null {
  const { data } = usePinStatus()
  const [changing, setChanging] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  if (!data || data.platform === null) {
    return null
  }
  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 5, md: 10 }}>
      <Box>
        <Text as="h2" textStyle="text/md" fontWeight="semibold" color="neutral.900">
          Security
        </Text>
        <Text mt={2} textStyle="text/sm" color="neutral.600" maxW="32ch" sx={{ textWrap: 'pretty' }}>
          Your PIN locks Control Center when you close it.
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
        {data.platform !== 'desktop' && (
          <Button
            size="sm"
            variant="outline"
            isLoading={signingOut}
            onClick={() => {
              setSigningOut(true)
              void signOutEverywhere().then((result) => {
                if (result.isErr()) {
                  setSigningOut(false)
                  toast.error('Couldn’t sign out everywhere. Try again.')
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

const STEPS = {
  current: {
    index: 0,
    title: 'Enter your current PIN',
    description: 'Then you’ll choose a new one.',
    label: 'Current PIN',
  },
  new: {
    index: 1,
    title: 'Choose a new PIN',
    description: '6 digits you’ll enter each time you open Control Center.',
    label: 'New PIN, 6 digits',
  },
  confirm: {
    index: 2,
    title: 'Confirm your new PIN',
    description: 'Enter the same 6 digits again.',
    label: 'Confirm your new PIN',
  },
}

/** Current PIN, then the new one twice. One field throughout, so a message stays until typing. */
function ChangePinDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const field = usePinField()
  const descriptionId = useId()
  const [change, setChange] = useState<ChangeStep>({ step: 'current' })
  const [direction, setDirection] = useState(1)

  const go = (next: ChangeStep, towards: 1 | -1 = 1): void => {
    setDirection(towards)
    setChange(next)
  }

  const complete = (pin: string): void => {
    if (change.step === 'current') {
      void field
        // Nothing has changed yet, so no success check until the end.
        .check(async () => baseTrpc.auth.confirmPin.mutate({ pin }), { celebrate: false })
        .then((result) => {
          if (result === 'accepted') {
            field.clear()
            go({ step: 'new', current: pin })
          }
        })
    } else if (change.step === 'new') {
      field.clear()
      go({ step: 'confirm', current: change.current, next: pin })
    } else if (pin !== change.next) {
      void field.reject(MISMATCH_MESSAGE).then(() => {
        go({ step: 'new', current: change.current }, -1)
      })
    } else {
      void field
        .check(async () => baseTrpc.auth.changePin.mutate({ currentPin: change.current, newPin: pin }))
        .then((result) => {
          if (result === 'accepted') {
            toast.success('PIN changed')
            onClose()
          } else {
            // Refused: the current PIN no longer works, or a wrong-PIN delay is running; the field says which.
            go(result === 'refused' ? { step: 'current' } : { step: 'new', current: change.current }, -1)
          }
        })
    }
  }

  const { index, title, description, label } = STEPS[change.step]
  return (
    <Modal isOpen onClose={onClose} isCentered size="md">
      <ModalOverlay />
      <ModalContent mx={4}>
        <ModalCloseButton />
        <PinSteps step={change.step} direction={direction}>
          <StepTitle>{title}</StepTitle>
          <Text id={descriptionId} mt={2} textStyle="text/md" color="neutral.600">
            {description}
          </Text>
          <Box mt={6}>
            <PinInput
              field={field}
              label={label}
              autoComplete={change.step === 'current' ? 'current-password' : 'new-password'}
              checksPin={change.step === 'current'}
              descriptionId={descriptionId}
              onComplete={complete}
            />
          </Box>
        </PinSteps>
        <VisuallyHidden aria-live="polite">Step {index + 1} of 3</VisuallyHidden>
        <Flex align="center" minH={9}>
          {change.step !== 'current' && (
            <Button
              variant="ghost"
              size="sm"
              ms={-4}
              color="neutral.600"
              onClick={() => {
                field.clear()
                go(change.step === 'confirm' ? { step: 'new', current: change.current } : { step: 'current' }, -1)
              }}
            >
              Back
            </Button>
          )}
          <Box ms="auto">
            <StepDots count={3} current={index} />
          </Box>
        </Flex>
      </ModalContent>
    </Modal>
  )
}
