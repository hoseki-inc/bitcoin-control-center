import { type StackProps, Text, VStack, useDisclosure } from '@chakra-ui/react'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui'
import { keyIcon } from '@hoseki/packages/ui/prove-verify-ui/claims/keystores-status-indicator'
import type { SupportedHardwareWallet } from '@hoseki/packages/wallet'
import { CircleAlertIcon } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { toast } from 'sonner'
import { trpc } from '../../trpc'
import { NewDeviceConnectionModal } from '../multisig/new-device-connection-modal'
import { WalletImageFromKnownModel } from './wallet-image-from-known-model'

interface ResumeSinglesigFlowProps extends StackProps {
  wallet: SupportedHardwareWallet | null
  model: string | null
}
export function ResumeSinglesigFlow({ wallet, model, ...props }: ResumeSinglesigFlowProps): JSX.Element {
  return (
    <ResumeFlow
      wallet={wallet}
      model={model}
      description="This device has already been identified. Select 'Continue' to complete verification."
      bottomContent={null}
      {...props}
    />
  )
}

interface ResumeMultisigKeyFlowProps extends StackProps {
  wallet: SupportedHardwareWallet | null
  keystoreId: string
  model: string | null
}
export function ResumeMultisigKeyFlow({
  wallet,
  keystoreId,
  model,
  ...props
}: ResumeMultisigKeyFlowProps): JSX.Element {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const updateKeystoreMutation = trpc.portalProve.registry.claims.updateKeystore.useMutation()
  const trpcUtils = trpc.useUtils()

  useEffect(() => {
    if (updateKeystoreMutation.isSuccess) {
      toast.success('Device was reset', { description: 'You can now connect a new device.' })
      onClose()
      trpcUtils.portalProve.registry.claims.get.byId
        .invalidate(undefined, undefined, { throwOnError: true })
        .catch(() => {
          toast.error('Unable to refresh the account. Please reload the page.')
        })
      // Reset the mutation success state to prevent re-triggering
      updateKeystoreMutation.reset()
    }
  }, [
    updateKeystoreMutation.isSuccess,
    updateKeystoreMutation.reset,
    onClose,
    updateKeystoreMutation,
    trpcUtils.portalProve.registry.claims.get.byId,
  ])

  const bottomContent = wallet ? (
    <TipAlert
      as="button"
      title="Replace this device?"
      icon={CircleAlertIcon}
      onClick={onOpen}
      _hover={{ opacity: 0.8 }}
    >
      <Text textAlign="left" color="neutral.800">
        Click here to use a different device or start over with this key.
      </Text>
    </TipAlert>
  ) : null

  return (
    <>
      <ResumeFlow
        wallet={wallet}
        model={model}
        description="This device has already been identified as part of your multisig setup. Select 'Continue' to complete verification."
        bottomContent={bottomContent}
        {...props}
      />
      <NewDeviceConnectionModal
        isOpen={isOpen}
        onClose={onClose}
        onConfirm={() => {
          updateKeystoreMutation.mutate({ id: keystoreId, label: 'Key', wallet: null, model: null })
        }}
        isLoading={updateKeystoreMutation.isLoading}
      />
    </>
  )
}

type ResumeFlowProps = {
  wallet: SupportedHardwareWallet | null
  model: string | null
  description: string
  bottomContent: ReactNode
} & StackProps

function ResumeFlow({ wallet, model, description, bottomContent, ...props }: ResumeFlowProps) {
  return (
    <VStack spacing={4} left="center" maxW="640px" mx="auto" {...props}>
      {model != null && model !== '' ? (
        <WalletImageFromKnownModel wallet={wallet} model={model} />
      ) : (
        <KeystoreAvatar icon={keyIcon} variant="filled" size="200px" alt="Unidentified key" mb={8} />
      )}

      <VStack spacing={2} alignSelf="start" align="start">
        <Text as="h1" textStyle="text/2xl" fontWeight="medium" color="neutral.900" align="start">
          Continue Verification?
        </Text>
        <VStack spacing={0} align="start">
          <Text textStyle="text/md" color="neutral.900">
            {description}
          </Text>
        </VStack>
      </VStack>

      {bottomContent}
    </VStack>
  )
}
