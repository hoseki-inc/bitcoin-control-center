import { trpc } from '../../../trpc'
import { RenameInput } from './rename-input'

export function RenameKeystore({
  keystoreId,
  defaultName,
  onCancel,
}: {
  keystoreId: string
  defaultName: string
  onCancel: () => void
}): JSX.Element {
  const trpcUtils = trpc.useUtils()
  const updateKeystoreMutation = trpc.portalProve.registry.claims.updateKeystore.useMutation({
    onSuccess: async () => {
      await trpcUtils.portalProve.registry.claims.get.byId.invalidate()
      onCancel()
    },
  })

  return (
    <RenameInput
      inputId="keystore-name-input"
      defaultName={defaultName}
      placeholderName="Your keystore name"
      isLoading={updateKeystoreMutation.isLoading}
      onSaveClick={(updatedName) => {
        updateKeystoreMutation.mutate({ id: keystoreId, label: updatedName })
      }}
      onCancel={onCancel}
    />
  )
}
