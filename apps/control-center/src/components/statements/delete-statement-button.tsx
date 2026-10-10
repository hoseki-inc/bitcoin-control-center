import {
  Button,
  IconButton,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  useDisclosure,
} from '@chakra-ui/react'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { browserLogger } from '../../logger'
import { trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'

/**
 * Delete button with a confirmation dialog. Only offer it for completed or failed statements.
 * With `iconLabel`, it shows a trash icon labelled for screen readers instead of text.
 */
export function DeleteStatementButton({
  statementId,
  onDeleted,
  iconLabel,
  iconSize = 'md',
}: {
  statementId: StatementDto['id']
  onDeleted?: () => void
  iconLabel?: string
  iconSize?: 'sm' | 'md'
}): JSX.Element {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const trpcUtils = trpc.useUtils()
  const deleteMutation = trpc.portalProve.statement.delete.useMutation({
    onSuccess: () => {
      onClose()
      onDeleted?.()
      toast.success('Statement deleted')
    },
    onError: (err) => {
      browserLogger.error({ err }, 'Failed to delete statement')
      toast.error("Couldn't delete statement", { description: err.message })
    },
    // Refresh even when it failed: "not found" means another tab already deleted it.
    onSettled: async () => {
      await trpcUtils.portalProve.statement.list.invalidate()
    },
  })

  return (
    <>
      {iconLabel === undefined ? (
        <Button variant="outline" size="md" onClick={onOpen}>
          Delete
        </Button>
      ) : (
        <IconButton
          aria-label={iconLabel}
          icon={<Trash2Icon size={iconSize === 'sm' ? 16 : 18} aria-hidden="true" />}
          variant="ghost"
          size={iconSize}
          color="neutral.600"
          _hover={{ color: 'error.600', bg: 'error.50' }}
          onClick={onOpen}
        />
      )}
      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <Text textStyle="text/lg" color="neutral.900">
              Delete statement?
            </Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text textStyle="text/sm" color="neutral.600">
              This can&apos;t be undone.
            </Text>
          </ModalBody>
          <ModalFooter gap={2}>
            <Button variant="outline" onClick={onClose} size="md" flex={1} isDisabled={deleteMutation.isLoading}>
              Cancel
            </Button>
            <Button
              variant="error"
              size="md"
              flex={1}
              isLoading={deleteMutation.isLoading}
              onClick={() => {
                deleteMutation.mutate(statementId)
              }}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
