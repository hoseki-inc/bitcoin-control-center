import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
} from '@chakra-ui/react'

export interface ConfirmActionModalProps {
  isOpen: boolean
  onClose: () => void
  title: React.ReactNode
  body: React.ReactNode
  footer: React.ReactNode
}
export function ConfirmActionModal({ isOpen, onClose, title, body, footer }: ConfirmActionModalProps): JSX.Element {
  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <Text textStyle="text/lg" color="neutral.900">
            {title}
          </Text>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>{body}</ModalBody>

        <ModalFooter gap={2}>{footer}</ModalFooter>
      </ModalContent>
    </Modal>
  )
}
