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
import { useState } from 'react'
import { toast } from 'sonner'
import { signOutEverywhere, usePinStatus } from '../../pin/actions'
import { MISMATCH_MESSAGE, PinInput, usePinField } from '../../pin/pin-field'
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
        <Text mt={2} textStyle="text/sm" color="neutral.600" maxW="32ch">
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
  current: { title: 'Current PIN', label: 'Current PIN' },
  new: { title: 'New PIN', label: 'New PIN, 6 digits' },
  confirm: { title: 'Confirm', label: 'Confirm your new PIN' },
}

/** Current PIN, then the new one twice. One field throughout, so a message stays until typing. */
function ChangePinDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const field = usePinField()
  const [change, setChange] = useState<ChangeStep>({ step: 'current' })

  const complete = (pin: string): void => {
    if (change.step === 'current') {
      void field
        .check(async () => baseTrpc.auth.confirmPin.mutate({ pin }))
        .then((result) => {
          if (result === 'accepted') {
            field.clear()
            setChange({ step: 'new', current: pin })
          }
        })
    } else if (change.step === 'new') {
      field.clear()
      setChange({ step: 'confirm', current: change.current, next: pin })
    } else if (pin !== change.next) {
      void field.reject(MISMATCH_MESSAGE).then(() => {
        setChange({ step: 'new', current: change.current })
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
            setChange(result === 'refused' ? { step: 'current' } : { step: 'new', current: change.current })
          }
        })
    }
  }

  const { title, label } = STEPS[change.step]
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
            <PinInput
              field={field}
              stepKey={change.step}
              label={label}
              autoComplete={change.step === 'current' ? 'current-password' : 'new-password'}
              checksPin={change.step === 'current'}
              onComplete={complete}
            />
          </Stack>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
