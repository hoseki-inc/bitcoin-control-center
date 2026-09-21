import {
  Button,
  type ButtonProps,
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
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { browserLogger } from '../../../logger'
import { trpc } from '../../../trpc'
import { type ClaimDto } from '../../../trpc/server-types'

export type DeleteClaimModalProps = {
  action: 'abandon' | 'archive' | 'deletePending' | 'deletePermanently'
  isOpen: boolean
  onClose: () => void
  claim: {
    id: string
    displayName: string
    status: ClaimDto['status']
  }
}

export function DeleteClaimModal({ action, isOpen, onClose, claim }: DeleteClaimModalProps): JSX.Element {
  const trpcUtils = trpc.useUtils()
  const navigate = useNavigate()
  const isArchive = action === 'archive'
  const isAbandon = action === 'abandon'
  const isPendingDelete = action === 'deletePending'
  const archiveBalanceQuery = trpc.portalProve.onchain.claimBalances.useQuery(
    { claimIds: [claim.id] },
    { enabled: isOpen && isArchive },
  )
  const archiveBalance = archiveBalanceQuery.data?.get(claim.id)
  const isCurrentBalanceLoading = archiveBalanceQuery.isLoading || archiveBalanceQuery.isFetching
  const currentBalanceSats =
    archiveBalanceQuery.isSuccess && !archiveBalanceQuery.isFetching && archiveBalance !== undefined
      ? Number(archiveBalance.toString())
      : undefined

  const archiveMutation = trpc.portalProve.registry.claims.archive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        trpcUtils.portalProve.registry.claims.list.invalidate(),
        trpcUtils.portalProve.registry.claims.listArchived.invalidate(),
        trpcUtils.portalProve.controlCenter.getData.invalidate(),
      ])
      void navigate('/accounts')
      onClose()
      toast.success(`'${claim.displayName}' archived`)
    },
    onError: (err) => {
      browserLogger.error({ err }, 'Failed to archive claim')
      toast.error('Failed to archive account')
    },
  })

  const onDeleteSuccess = async (): Promise<void> => {
    await Promise.all([
      trpcUtils.portalProve.registry.claims.list.invalidate(),
      trpcUtils.portalProve.registry.claims.listArchived.invalidate(),
      trpcUtils.portalProve.controlCenter.getData.invalidate(),
    ])
    void navigate('/accounts')
    onClose()
    toast.success(isAbandon ? `'${claim.displayName}' setup abandoned` : `'${claim.displayName}' account deleted`)
  }

  const onDeleteError = (err: unknown): void => {
    browserLogger.error({ err }, 'Failed to delete claim')
    toast.error(isAbandon ? 'Failed to abandon setup' : 'Failed to delete account')
  }

  const deletePendingMutation = trpc.portalProve.registry.claims.deletePending.useMutation({
    onSuccess: onDeleteSuccess,
    onError: onDeleteError,
  })
  const deletePermanentlyMutation = trpc.portalProve.registry.claims.delete.useMutation({
    onSuccess: async () => {
      await onDeleteSuccess()
    },
    onError: onDeleteError,
  })

  const deleteMutation = isPendingDelete || isAbandon ? deletePendingMutation : deletePermanentlyMutation
  const isMutating = archiveMutation.isLoading || deletePendingMutation.isLoading || deletePermanentlyMutation.isLoading
  const isArchiveBalanceKnown = currentBalanceSats !== undefined && !isCurrentBalanceLoading

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <Text textStyle="text/lg" color="neutral.900">
            {isArchive
              ? 'Archive Account?'
              : isAbandon
                ? 'Abandon Account Setup?'
                : isPendingDelete
                  ? 'Delete Pending Account?'
                  : 'Delete Account Permanently?'}
          </Text>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
          {isArchive && isCurrentBalanceLoading && (
            <Text textStyle="text/sm" color="neutral.600" mb={3} fontWeight="medium">
              Checking the current balance before this account can be archived…
            </Text>
          )}
          {isArchive && !isCurrentBalanceLoading && currentBalanceSats === undefined && (
            <Text textStyle="text/sm" color="error.600" mb={3} fontWeight="medium">
              We could not determine this account&apos;s current balance. Archive is disabled; refresh and try again.
            </Text>
          )}
          {isArchive && currentBalanceSats !== undefined && currentBalanceSats > 0 && (
            <Text textStyle="text/sm" color="warning.600" mb={3} fontWeight="medium">
              This wallet still holds {(currentBalanceSats / 100_000_000).toFixed(8)} BTC. Archiving stops live balance
              tracking, so your displayed portfolio will drop by this amount and may look like the BTC was lost. The
              funds remain in your wallet, and historical data up to now will be preserved.
            </Text>
          )}
          {isArchive && (
            <Text textStyle="text/sm" color="neutral.600" mb={3}>
              <Text as="strong" fontWeight="medium" color="neutral.900">
                Archive
              </Text>{' '}
              hides{' '}
              <Text as="span" fontWeight="medium">
                {claim.displayName}
              </Text>{' '}
              from your dashboard. Its history through the archive time is kept; after that, the account is removed from
              displayed portfolio totals and chart tracking.
            </Text>
          )}
          {!isArchive && (
            <Text textStyle="text/sm" color="neutral.600">
              <Text as="strong" fontWeight="medium" color="error.600">
                {isAbandon ? 'Abandon' : isPendingDelete ? 'Delete' : 'Delete Permanently'}
              </Text>{' '}
              removes{' '}
              <Text as="span" fontWeight="medium">
                {claim.displayName}
              </Text>{' '}
              {isAbandon
                ? 'and all captured balance history for this unfinished verification setup.'
                : isPendingDelete
                  ? 'and its unfinished verification setup.'
                  : 'and all balance history for this account.'}{' '}
              This cannot be undone.
            </Text>
          )}
        </ModalBody>

        <ModalFooter gap={2}>
          <Button variant="outline" onClick={onClose} size="md" flex={1} isDisabled={isMutating}>
            Cancel
          </Button>
          {isArchive ? (
            <Button
              isLoading={archiveMutation.isLoading}
              isDisabled={!isArchiveBalanceKnown || (isMutating && !archiveMutation.isLoading)}
              onClick={() => {
                archiveMutation.mutate({ id: claim.id })
              }}
              size="md"
              flex={1}
              variant="outline"
            >
              Archive
            </Button>
          ) : (
            <Button
              isLoading={deleteMutation.isLoading}
              isDisabled={isMutating && !deleteMutation.isLoading}
              onClick={() => {
                deleteMutation.mutate({ id: claim.id })
              }}
              size="md"
              flex={1}
              variant="error"
            >
              {isAbandon ? 'Abandon' : isPendingDelete ? 'Delete' : 'Delete Permanently'}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export function AbandonClaimButton({
  claim,
  ...props
}: { claim: DeleteClaimModalProps['claim'] } & Omit<ButtonProps, 'children' | 'onClick'>): JSX.Element {
  const { isOpen, onOpen, onClose } = useDisclosure()

  return (
    <>
      <Button variant="ghost" color="error.600" onClick={onOpen} {...props}>
        Abandon
      </Button>
      <DeleteClaimModal action="abandon" isOpen={isOpen} onClose={onClose} claim={claim} />
    </>
  )
}
