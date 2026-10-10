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
import { useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { browserLogger } from '../../logger'
import { trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { deleteStatementLabel } from '../dashboard/statement-card'

/**
 * Delete button with a confirmation dialog, shown for completed or failed statements.
 * The icon variant shows a trash icon labelled for screen readers instead of text.
 */
export function DeleteStatementButton({
  statement,
  onDeleted,
  variant = 'text',
  iconSize = 'md',
}: {
  statement: StatementDto
  onDeleted?: () => void
  variant?: 'text' | 'icon'
  iconSize?: 'sm' | 'md'
}): JSX.Element | null {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const queryClient = useQueryClient()
  const trpcUtils = trpc.useUtils()
  const deleted = async (): Promise<void> => {
    onClose()
    // Forget it, so going Back to its page says it's gone instead of showing it again,
    // and so statement lists don't show it while they refresh.
    queryClient.removeQueries({ queryKey: getQueryKey(trpc.portalProve.statement.retrieve, statement.id, 'query') })
    trpcUtils.portalProve.statement.list.setData(undefined, (statements) =>
      statements?.filter((item) => item.id !== statement.id),
    )
    onDeleted?.()
    toast.success('Statement deleted')
    await trpcUtils.portalProve.statement.list.invalidate()
  }
  const deleteMutation = trpc.portalProve.statement.delete.useMutation({
    onSuccess: deleted,
    onError: async (err) => {
      // Another tab or device deleted it first.
      if (err.data?.code === 'NOT_FOUND') {
        await deleted()
        return
      }
      browserLogger.error({ err }, 'Failed to delete statement')
      toast.error("Couldn't delete statement", { description: err.message })
    },
  })

  if (statement.status === 'pending') {
    return null
  }

  return (
    <>
      {variant === 'text' ? (
        <Button variant="outline" size="md" onClick={onOpen}>
          Delete
        </Button>
      ) : (
        <IconButton
          aria-label={deleteStatementLabel(statement)}
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
                deleteMutation.mutate(statement.id)
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
