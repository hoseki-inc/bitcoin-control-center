import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
} from '@chakra-ui/react'

export interface RemoveAccountModalProps {
  isOpen: boolean
  onClose: () => void
  accountName: string
  description: string
  isDeleting: boolean
  onConfirm: () => void
}

export function RemoveAccountModal({
  isOpen,
  onClose,
  accountName,
  description,
  isDeleting,
  onConfirm,
}: RemoveAccountModalProps): JSX.Element {
  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <Text textStyle="text/lg" color="neutral.900">
            Remove {accountName}?
          </Text>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text textStyle="text/sm" color="neutral.600">
            {description}
          </Text>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="outline" onClick={onClose} size="md" flex={1} isDisabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="error" size="md" flex={1} isLoading={isDeleting} onClick={onConfirm}>
            Remove
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
