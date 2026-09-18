import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
} from '@chakra-ui/react'

type NewDeviceConnectionModalProps = {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  isLoading: boolean
}

export function NewDeviceConnectionModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}: NewDeviceConnectionModalProps): JSX.Element {
  function handleClose() {
    if (isLoading) {
      return
    }
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} isCentered size="sm">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <Text textStyle="text/lg" color="neutral.900" fontWeight="medium">
            Start Over With a New Device?
          </Text>
        </ModalHeader>

        <ModalBody>
          <Text textStyle="text/sm" color="neutral.600" mb={4}>
            You're about to reconnect your wallet using a new hardware device.
          </Text>
          <Text textStyle="text/sm" color="neutral.600">
            To keep your proof secure, we'll need to start the verification process from scratch and check that this
            device still controls the same key you previously verified
          </Text>
        </ModalBody>

        <ModalFooter>
          <HStack width="full">
            <Button variant="tertiary" onClick={() => onClose()} isDisabled={isLoading} size="md" flex={1}>
              Cancel
            </Button>
            <Button onClick={onConfirm} isLoading={isLoading} size="md" variant="outline" flex={1}>
              Connect New Device
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
