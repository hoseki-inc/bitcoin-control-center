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
  const updateClaimMutation = trpc.portalProve.registry.claims.update.useMutation({
    onSuccess: async () => {
      await trpcUtils.portalProve.registry.claims.get.byId.invalidate()
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
