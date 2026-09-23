import { Box, Button, FormControl, FormErrorMessage, FormLabel, Input, Stack, Text, chakra } from '@chakra-ui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { MultiSigAccount } from '@hoseki/packages/bitcoin'
import { Err, Ok, Result } from '@hoseki/packages/result'
import { FileDropReader, type FileDropState, PageTransition } from '@hoseki/packages/ui/design-system'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { ClaimConnectionWrapper, WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Link as RouterLink, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { AnimatedDetectedKeystoreAvatars } from '../../components/multisig/animated-detected-keystore-avatars'
import { MultisigAnimation } from '../../components/multisig/multisig-animation'
import { MultisigFromDescriptor } from '../../components/multisig/multisig-from-descriptor'
import { parseWalletExport } from '../../lib/multisig/wallet-export-parser'
import { trpc } from '../../trpc'
import type { CreateMultisigClaimInput, CreateMultisigKeystoreInput } from '../../trpc/server-types'

export function MultisigCreatePage(): JSX.Element {
  const navigate = useNavigate()
  const [isSaving, setIsSaving] = useState(false)
  const [step, setStep] = useState<'get-ready' | 'upload' | 'detection'>('get-ready')
  const [detectedWallet, setDetectedWallet] = useState<CreateMultisigClaimInput | null>(null)

  const trpcUtils = trpc.useUtils()
  const createMultisigClaimMutation = trpc.portalProve.registry.claims.create.multisig.useMutation()
  const updateClaimMutation = trpc.portalProve.registry.claims.update.useMutation()

  async function handleClaimCreation(updatedName: string) {
    if (!detectedWallet) {
      return
    }

    setIsSaving(true)

    const updatedWallet = { ...detectedWallet, displayName: updatedName }
    setDetectedWallet(updatedWallet)

    // Try to get existing claim first
    const existingClaimResult = await Result.fromPromise(
      trpcUtils.portalProve.registry.claims.get.byAccount.fetch({
        network: 'bitcoin_mainnet',
        account: detectedWallet.account,
      }),
    )

    if (existingClaimResult.isOk()) {
      // Update existing claim
      const claim = existingClaimResult.unwrap()
      if (claim.isArchived) {
        setIsSaving(false)
        toast.info('This account is archived', {
          description: 'Restore it from Archived accounts before reconnecting.',
        })
        navigate('/accounts#archived')
        return
      }

      await Result.fromPromise(updateClaimMutation.mutateAsync({ id: claim.id, displayName: updatedName }))
        .andThen((data) => {
          navigate(data.status === 'pending' ? `/multisig/${claim.id}` : `/accounts/${claim.id}`)
          return Ok()
        })
        .inspectErr((err) => {
          setIsSaving(false)
          toast.error('Failed to update claim', { description: err.message })
          return Err(err)
        })
    } else {
      // Create new claim
      await Result.fromPromise(createMultisigClaimMutation.mutateAsync(updatedWallet))
        .andThen((claimAggregate) => {
          navigate(`/multisig/${claimAggregate.claim.id}`)
          return Ok()
        })
        .inspectErr((err) => {
          setIsSaving(false)
          toast.error('Failed to create claim', { description: err.message })
          return Err(err)
        })
    }
  }

  return (
    <ClaimConnectionWrapper pt={8}>
      <PageTransition key={step}>
        {step === 'get-ready' && (
          <>
            <MultisigAnimation animation="1" />
            <GetReady onNext={() => setStep('upload')} />
          </>
        )}
        {step === 'upload' && (
          <>
            <MultisigAnimation animation="2" />
            <ImportWallet
              onBack={() => setStep('get-ready')}
              onNext={(data) => {
                setDetectedWallet(data)
                setStep('detection')
              }}
            />
          </>
        )}
        {step === 'detection' && detectedWallet && (
          <DetectionStep
            wallet={detectedWallet}
            isSaving={isSaving}
            onBack={() => setStep('upload')}
            onNext={handleClaimCreation}
          />
        )}
      </PageTransition>
    </ClaimConnectionWrapper>
  )
}

function GetReady({ onNext }: { onNext: () => void }) {
  return (
    <Stack gap={4}>
      <Text as="h1" textStyle="text/2xl" fontWeight="medium">
        Connect Your Multisig Wallet
      </Text>
      <Text textStyle="text/md" color="text.primary">
        You’re about to connect your multisig wallet to Bitcoin Control Center. This lets you verify ownership of your
        bitcoin using your existing multisig setup—no funds will be moved, and your custody remains unchanged.
      </Text>
      <Box>
        <Text textStyle="text/md" color="text.primary">
          To complete this step, you will:
        </Text>
        <chakra.ol ml={6} textStyle="text/md" color="text.primary">
          <li>Upload your wallet’s descriptor file.</li>
          <li>Sign a message with your hardware keys.</li>
        </chakra.ol>
      </Box>
      <Text textStyle="text/md" color="text.primary">
        You can sign with your keys in any order—whichever is most convenient for your setup.
      </Text>

      <TipAlert
        title="Security tip"
        icon={CircleAlert}
        children={
          <Text color="text.primary">
            Only upload this file to Bitcoin Control Center. For best security, delete it once you’ve completed the
            process.
          </Text>
        }
      />

      <WizardFooter
        leftButton={
          <Button as={RouterLink} to="/accounts" variant="outline">
            Back
          </Button>
        }
        rightButton={<Button onClick={onNext}>Next</Button>}
      />
    </Stack>
  )
}

function ImportWallet({ onBack, onNext }: { onBack: () => void; onNext: (data: CreateMultisigClaimInput) => void }) {
  const [fileDropStatus, setFileDropStatus] = useState<FileDropState>('ready')

  return (
    <Stack gap={4}>
      <Text as="h1" textStyle="text/2xl" fontWeight="medium">
        Upload Your Multisig Descriptor
      </Text>
      <Text textStyle="text/md" color="text.primary">
        Upload your wallet’s output descriptor so we can read your multisig configuration. You can export this file from
        your hardware wallet or multisig coordinator (such as Sparrow, Unchained, or Nunchuk).
      </Text>
      <FileDropReader
        readyText="Drag the file here, or paste your descriptor manually below"
        invalidText="Invalid file. Please check your file and try again."
        validText="Success!"
        validationFn={(rawContent, file): Result<CreateMultisigClaimInput, Error> =>
          parseAndMapWalletFile(rawContent, file.type)
        }
        onValidContentRead={onNext}
        acceptedFileTypes={['txt', 'json']}
        status={fileDropStatus}
        onStatusChange={setFileDropStatus}
      />

      <TipAlert
        title="Need help?"
        icon={CircleAlert}
        children={
          <Text color="text.primary">
            Visit our{' '}
            <Link
              to="https://help.hoseki.app/article/43-how-to-export-your-multisig-wallet"
              style={{ textDecoration: 'underline' }}
              target="_blank"
            >
              Help Center
            </Link>{' '}
            for step-by-step export instructions.
          </Text>
        }
      />

      <MultisigFromDescriptor onNext={onNext} />

      <WizardFooter
        leftButton={
          <Button onClick={onBack} variant="outline">
            Back
          </Button>
        }
      />
    </Stack>
  )
}

function parseAndMapWalletFile(rawContent: string, fileType: string): Result<CreateMultisigClaimInput, Error> {
  const parseResult = parseWalletExport(rawContent, fileType)
  if (parseResult.isErr()) {
    return Err(parseResult.unwrapErr())
  }

  const parsedWallet = parseResult.unwrap()

  const keystores: CreateMultisigKeystoreInput[] = []
  for (const keyExpression of parsedWallet.wallet.keyExpressions) {
    const derivationPath = keyExpression.keyOrigin?.derivationPath

    // NOTE: we are intentionally not setting the wallet type + label here, since we want the user to do it via our process
    keystores.push({
      label: 'Key',
      derivationPath: derivationPath?.toString() ?? null,
      publicKey: keyExpression.xpub.toString(),
      wallet: null,
      model: null,
    })
  }

  const account = MultiSigAccount.fromWallet(parsedWallet.wallet)

  return Ok({
    displayName: parsedWallet.label ?? `${parsedWallet.walletType ?? 'Imported Multisig'} Wallet`,
    account: account.descriptor(),
    network: 'bitcoin_mainnet',
    keystores,
  })
}

const schema = z.object({
  claimName: z.string().min(1, 'Name can not be empty').max(255, 'Name exceeds limit of 255 characters'),
})

type ClaimNameForm = z.infer<typeof schema>

function DetectionStep({
  wallet,
  isSaving,
  onBack,
  onNext,
}: {
  wallet: CreateMultisigClaimInput
  isSaving: boolean
  onBack: () => void
  onNext: (name: string) => void
}) {
  const account = MultiSigAccount.fromCheckedDescriptor(wallet.account)

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<ClaimNameForm>({
    defaultValues: {
      claimName: wallet.displayName,
    },
    mode: 'onChange',
    reValidateMode: 'onChange',
    resolver: zodResolver(schema),
  })

  function onSubmit(data: { claimName: string }) {
    onNext(data.claimName)
  }

  return (
    <Stack gap={4}>
      <Text as="h1" textStyle="text/2xl" fontWeight="medium">
        We've detected a {account.threshold} of {wallet.keystores.length} Multisig Wallet
      </Text>

      <AnimatedDetectedKeystoreAvatars totalKeystores={wallet.keystores.length} threshold={account.threshold} />

      <Text textStyle="text/md" color="text.primary">
        Let's name your multisig claim. You rename this later at anytime.
      </Text>

      <form onSubmit={handleSubmit(onSubmit)}>
        <FormControl isInvalid={Boolean(errors.claimName)}>
          <FormLabel htmlFor="claim-name">Name</FormLabel>
          <Input id="claim-name" {...register('claimName')} placeholder="Multisig claim name" autoFocus />
          {errors.claimName && <FormErrorMessage>{errors.claimName.message}</FormErrorMessage>}
        </FormControl>

        <WizardFooter
          leftButton={
            <Button onClick={onBack} variant="outline">
              Back
            </Button>
          }
          rightButton={
            <Button type="submit" isDisabled={!isValid} isLoading={isSaving}>
              Next
            </Button>
          }
        />
      </form>
    </Stack>
  )
}
