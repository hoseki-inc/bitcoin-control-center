import { trpc } from '../../../trpc'
import { RenameInput } from './rename-input'

export function RenameClaim({
  claimId,
  defaultName,
  onCancel,
}: {
  claimId: string
  defaultName: string
  onCancel: () => void
}): JSX.Element {
  const trpcUtils = trpc.useUtils()
  const updateClaimMutation = trpc.portalProve.accounts.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        trpcUtils.portalProve.accounts.get.byId.invalidate(),
        trpcUtils.portalProve.accounts.list.invalidate(),
        trpcUtils.portalProve.accounts.listArchived.invalidate(),
        trpcUtils.portalProve.portfolio.getData.invalidate(),
      ])
      onCancel()
    },
  })

  return (
    <RenameInput
      inputId="claim-name-input"
      defaultName={defaultName}
      placeholderName="Your claim name"
      isLoading={updateClaimMutation.isLoading}
      onSaveClick={(updatedName) => {
        updateClaimMutation.mutate({ id: claimId, displayName: updatedName })
      }}
      onCancel={onCancel}
    />
  )
}
