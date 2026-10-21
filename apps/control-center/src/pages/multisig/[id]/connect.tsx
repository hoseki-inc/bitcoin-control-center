import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  Icon,
  Input,
  Stack,
  Text,
  chakra,
} from '@chakra-ui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { DerivationPath, type Xpub } from '@hoseki/packages/bitcoin'
import { Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import { Alert, Badge, Spinner } from '@hoseki/packages/ui/design-system'
import { GreenCheckIcon } from '@hoseki/packages/ui/prove-verify-ui'
import {
  ClaimConnectionWrapper,
  type ColdcardGenericJsonFile,
  type ColdcardModel,
  FloatingKeystoneImage,
  FloatingLedgerImage,
  FloatingTrezorImage,
  HardwareWalletError,
  type KeystoneExportFile,
  TrezorInfo,
  type TrezorModel,
  WalletAnimation,
  WizardFooter,
  getBitcoinXpubFromColdcardExport,
  getBitcoinXpubFromKeystoneExport,
  getLedgerModel,
  getTrezorModel,
} from '@hoseki/packages/ui/wallet-ui'
import { Slip132, type SupportedHardwareWallet } from '@hoseki/packages/wallet'
import { InfoIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { ColdcardQrConnectionSteps } from '../../../components/claims/coldcard/coldcard-qr-steps'
import {
  ColdcardConnectionInfo,
  type ColdcardConnectionMethods,
  ColdcardModelImage,
  Step4,
  Step5,
} from '../../../components/claims/coldcard/coldcard-steps'
import { KeystoneQrConnectionSteps } from '../../../components/claims/keystone/keystone-qr-steps'
import { LedgerConnectionInfo } from '../../../components/claims/ledger/ledger-connection-info'
import { trezorService } from '../../../components/claims/trezor/trezor-service-singleton'
import { RequiredDataMissing } from '../../../components/errors/required-data-missing'
import { useMultisigPageWrapperContext } from '../../../components/multisig/multisig-page-wrapper'
import { useLedgerStore, useToastOnLedgerDisconnect } from '../../../hooks/use-ledger-store'
import { getKeystoreStatus, getXpubFrom } from '../../../lib/multisig/keystore'
import { browserLogger } from '../../../logger'
import { trpc } from '../../../trpc'
import type { ClaimDto, KeystoreDto } from '../../../trpc/server-types'

export function MultisigConnectPage(): JSX.Element {
  const { walletType } = useParams<{ walletType: string }>()
  const { claim } = useMultisigPageWrapperContext()

  return (
    <ClaimConnectionWrapper>
      {walletType === 'ledger' && <ConnectLedgerWallet claim={claim} />}
      {walletType === 'trezor' && <ConnectTrezorWallet claim={claim} />}
      {walletType === 'coldcard' && <ConnectColdcardWallet claim={claim} />}
      {walletType === 'keystone' && <ConnectKeystoneWallet claim={claim} />}
    </ClaimConnectionWrapper>
  )
}

function ConnectLedgerWallet({ claim }: { claim: ClaimDto }) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'ledger-device-unlock' | 'ledger-device-check-xpub'>('ledger-device-unlock')

  useToastOnLedgerDisconnect()

  return (
    <>
      {step === 'ledger-device-unlock' && (
        <LedgerConnectionInfo
          onBack={() => {
            void navigate(`/multisig/${claim.id}`)
          }}
          onContinue={() => {
            setStep('ledger-device-check-xpub')
          }}
        />
      )}
      {step === 'ledger-device-check-xpub' && <ConnectLedgerWalletCheckXpub claim={claim} />}
    </>
  )
}

function ConnectLedgerWalletCheckXpub({ claim }: { claim: ClaimDto }) {
  const getBitcoinXpubFromPath = useLedgerStore((state) => state.getBitcoinXpubFromPath)
  const deviceModel = useLedgerStore((state) => state.deviceModel)

  async function getXpubFromLedger() {
    return getXpubFrom({
      claim,
      getXpubForPath: (derivationPath) =>
        getBitcoinXpubFromPath(derivationPath.toString(true))
          .map(({ xpub }) => Slip132.getXpubFromString(xpub))
          .flatten(),
      deviceType: 'ledger',
    })
  }

  const ledgerModel = getLedgerModel(deviceModel?.id ?? 'unknown')

  return (
    <GenericCheckWalletXpub
      claim={claim}
      keystoreMetadata={{ label: 'Ledger Wallet', walletType: 'ledger' }}
      getXpubFromDevice={getXpubFromLedger}
      media={<FloatingLedgerImage modelName={ledgerModel ?? 'Nano S Plus'} />}
      getDeviceModel={async () => ledgerModel ?? 'Nano S Plus'}
    />
  )
}

function ConnectTrezorWallet({ claim }: { claim: ClaimDto }) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'trezor-device-unlock' | 'trezor-device-check-xpub'>('trezor-device-unlock')
  const [model, setModel] = useState<TrezorModel | null>(null)

  async function getDeviceDetails(): Promise<Result<void, Error>> {
    const result = await trezorService.getFeatures()
    if (result.isErr()) {
      browserLogger.error(result.unwrapErr(), 'Failed to get Trezor features')
      setModel(null)
    } else {
      setModel(getTrezorModel(result.unwrap().internal_model))
    }
    setStep('trezor-device-check-xpub')
    return Ok()
  }

  return (
    <>
      {step === 'trezor-device-unlock' && (
        <TrezorInfo
          step="device-details"
          onBack={() => {
            void navigate(`/multisig/${claim.id}`)
          }}
          onConnectTrezor={getDeviceDetails}
        />
      )}
      {step === 'trezor-device-check-xpub' && (
        <ConnectTrezorWalletCheckXpub
          claim={claim}
          media={
            model == null ? <WalletAnimation animation="trezorPlugIn" /> : <FloatingTrezorImage modelName={model} />
          }
          model={model}
        />
      )}
    </>
  )
}

function ConnectTrezorWalletCheckXpub({
  claim,
  media,
  model,
}: {
  claim: ClaimDto
  media: React.ReactNode
  model: TrezorModel | null
}) {
  async function getXpubFromTrezor() {
    // Suite Web opens a popup per request, so every keystore path is read in one bundled request
    const paths = [
      ...new Set(
        claim.keystores.flatMap((ks) =>
          ks.derivationPath == null ? [] : [DerivationPath.from(ks.derivationPath).toString(true)],
        ),
      ),
    ]
    const publicKeysRes = await trezorService.getPublicKeys(paths)
    const publicKeysByPathRes = publicKeysRes.map((publicKeys) => {
      const publicKeysByPath = new Map<string, string>()
      for (const publicKey of publicKeys) {
        publicKeysByPath.set(publicKey.serializedPath, publicKey.xpub)
      }
      return publicKeysByPath
    })

    return getXpubFrom({
      claim,
      getXpubForPath: (derivationPath) =>
        publicKeysByPathRes.andThen((publicKeysByPath): Result<Xpub, Error> => {
          const path = derivationPath.toString(true)
          const rawXpub = publicKeysByPath.get(path)
          if (rawXpub === undefined) {
            return Err(new Error(`Trezor did not return a public key for ${path}`))
          }
          return Slip132.getXpubFromString(rawXpub)
        }),
      deviceType: 'trezor',
    })
  }

  return (
    <GenericCheckWalletXpub
      claim={claim}
      keystoreMetadata={{ label: 'Trezor Wallet', walletType: 'trezor' }}
      getXpubFromDevice={getXpubFromTrezor}
      media={media}
      // The device details were read in a separate Trezor Suite request
      getDeviceModel={async () => model}
    />
  )
}

const schema = z.object({
  keystoreName: z.string().min(1, 'Name can not be empty').max(255, 'Name exceeds limit of 255 characters'),
})

type KeystoreNameForm = z.infer<typeof schema>

function GenericCheckWalletXpub({
  claim,
  keystoreMetadata,
  getXpubFromDevice,
  media,
  getDeviceModel,
}: {
  claim: ClaimDto
  keystoreMetadata: { label: string; walletType: SupportedHardwareWallet }
  getXpubFromDevice: () => Promise<Result<Xpub, Error>>
  media: React.ReactNode
  getDeviceModel: () => Promise<string | null>
}) {
  const navigate = useNavigate()
  const [matchedKeystore, setMatchedKeystore] = useState<{ keystore: KeystoreDto | null; match: boolean } | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const updateKeystore = trpc.portalProve.registry.claims.updateKeystore.useMutation()
  const createChallengeMessage = trpc.portalProve.registry.challengeMessages.create.useMutation()

  const containsNonStandardPaths = claim.keystores.some(
    (keystore) =>
      keystore.derivationPath != null &&
      keystore.derivationPath.length > 0 &&
      !DerivationPath.from(keystore.derivationPath).isStandardAccount(),
  )

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<KeystoreNameForm>({
    defaultValues: {
      keystoreName: '',
    },
    mode: 'onChange',
    reValidateMode: 'onChange',
    resolver: zodResolver(schema),
  })

  async function performXpubCheck() {
    setIsChecking(true)
    setError(null)

    try {
      const deviceModel = await getDeviceModel()
      const xpubResult = await getXpubFromDevice()
      if (xpubResult.isErr()) {
        setError(xpubResult.unwrapErr())
        return
      }

      const xpub = xpubResult.unwrap()
      const matchedKeyStore = claim.keystores.find((ks) => ks.xpub.toString() === xpub.toString())
      if (!matchedKeyStore) {
        setMatchedKeystore({ keystore: null, match: false })
        return
      }

      const status = getKeystoreStatus(matchedKeyStore, claim)
      if (status === 'verified') {
        setMatchedKeystore({ keystore: matchedKeyStore, match: true })
        toast.info('Device already signed', { description: 'Continue with a different device.' })
        void navigate(`/multisig/${claim.id}`)
        return
      }

      const withDeviceModel = { ...matchedKeyStore, model: deviceModel }
      setMatchedKeystore({ keystore: withDeviceModel, match: true })
      return
    } catch (caughtError) {
      browserLogger.error(caughtError, 'Error checking xpub')
      setError(
        caughtError instanceof Error
          ? caughtError
          : new Error('Error checking xpub. Was the device unlocked and plugged in?'),
      )
    } finally {
      setIsChecking(false)
    }
  }

  async function onSubmit(data: { keystoreName: string }) {
    if (!matchedKeystore?.keystore) {
      return
    }

    try {
      setIsSaving(true)
      await updateKeystore.mutateAsync({
        id: matchedKeystore.keystore.id,
        label: data.keystoreName,
        wallet: keystoreMetadata.walletType,
        model: matchedKeystore.keystore.model,
      })

      const signedMessage = claim.latestChallenge?.messages.find((m) => m.keystoreId === matchedKeystore.keystore?.id)

      if (!signedMessage) {
        await createChallengeMessage.mutateAsync({
          keystoreId: matchedKeystore.keystore.id,
          challengeId: claim.latestChallenge?.id ?? '',
        })
      }
      // Signing needs the saved message, so stay here with the error if saving failed.
      void navigate(`/multisig/${claim.id}/signing/${keystoreMetadata.walletType}/${matchedKeystore.keystore.id}`)
    } catch (caughtError) {
      browserLogger.error('### Error: ', caughtError)
      setError(caughtError instanceof Error ? caughtError : new Error('Error saving keystore'))
    } finally {
      setIsSaving(false)
    }
  }

  if (isChecking) {
    return (
      <Stack gap={4}>
        {media}
        <Box textAlign="center">
          <Spinner centered />
        </Box>
        <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
          Verifying Your Wallet...
        </Text>
        <Text textStyle="text/md">Checking if this device belongs to your multisig setup...</Text>
        <Text textStyle="text/md">
          Follow the on-screen instructions. Your {keystoreMetadata.walletType} will verify identity while your keys
          remain safely stored on your device.
        </Text>
        {containsNonStandardPaths && (
          <Alert bgColor="neutral.50">
            <HStack>
              <Icon as={InfoIcon} color="neutral.900" boxSize="20px" />
              <Box color="neutral.800">
                <Text textStyle="text/sm" fontWeight="medium">
                  Seeing an &quot;unusual derivation path&quot; warning?
                </Text>
                <Text textStyle="text/sm" fontWeight="regular">
                  Some wallets use custom paths, which can trigger this message. This is normal.
                </Text>
              </Box>
            </HStack>
          </Alert>
        )}
      </Stack>
    )
  }

  return (
    <Stack>
      {error && <HardwareWalletError error={error} mt={4} />}

      {matchedKeystore && matchedKeystore.match && (
        <Stack gap={4}>
          {media}
          <Box>
            <Box textAlign="center">
              <GreenCheckIcon boxSize={12} color="green.500" />
            </Box>
            <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
              Wallet Identified
            </Text>
          </Box>

          <Text textStyle="text/md">This device is part of your multisig setup.</Text>
          <Text textStyle="text/md">Give this device a name—you can update it later at any time.</Text>

          <form
            onSubmit={(event) => {
              handleSubmit(onSubmit)(event).catch(() => {
                setError(new Error('Unable to submit the keystore name. Please try again.'))
              })
            }}
          >
            <FormControl isInvalid={Boolean(errors.keystoreName)}>
              <FormLabel htmlFor="keystore-name">Name</FormLabel>
              <Input id="keystore-name" {...register('keystoreName')} placeholder="Multisig keystore name" />
              {errors.keystoreName && <FormErrorMessage>{errors.keystoreName.message}</FormErrorMessage>}
            </FormControl>
            <WizardFooter
              leftButton={
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigate(`/multisig/${claim.id}`)
                  }}
                >
                  Cancel
                </Button>
              }
              rightButton={
                <Button type="submit" width="fit-content" isDisabled={!isValid} isLoading={isSaving}>
                  Continue
                </Button>
              }
            />
          </form>
        </Stack>
      )}

      {matchedKeystore && !matchedKeystore.match && (
        <Stack gap={4}>
          <Box textAlign="center">
            <Icon as={XIcon} color="red" mx="auto" boxSize={10} />
          </Box>
          <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
            Not a match :(
          </Text>
          <Text textStyle="text/md">The xpub returned from your device does not match any of your keystores.</Text>
          <Button
            onClick={() => {
              void navigate(`/multisig/${claim.id}`)
            }}
            width="fit-content"
          >
            Try Again
          </Button>
        </Stack>
      )}

      {!matchedKeystore && (
        <Stack gap={4}>
          {media}
          <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
            Confirm This Device Is Part of Your Multisig
          </Text>
          <Text textStyle="text/md" fontWeight="normal">
            Before we continue, we need to confirm that your{' '}
            <chakra.span textTransform="capitalize">{keystoreMetadata.walletType}</chakra.span> device is part of the
            multisig setup you provided.
          </Text>
          <TechnicalDetailsAccordion />

          <WizardFooter
            leftButton={
              <Button
                variant="outline"
                onClick={() => {
                  void navigate(`/multisig/${claim.id}`)
                }}
              >
                Cancel
              </Button>
            }
            rightButton={
              <Button
                onClick={() => {
                  void performXpubCheck()
                }}
                width="fit-content"
                isLoading={isChecking}
              >
                Check Now
              </Button>
            }
          />
        </Stack>
      )}
    </Stack>
  )
}

function TechnicalDetailsAccordion() {
  return (
    <Accordion allowMultiple border="solid 1px" borderColor="neutral.200" borderRadius="4px">
      <AccordionItem border="none">
        <h2>
          <AccordionButton p={4} _hover={{ bgColor: 'inherit' }}>
            <HStack flex="1">
              <Badge>Advanced</Badge>
              <Text as="h3" textStyle="text/sm" color="neutral.600" fontWeight={500}>
                Show Technical Details
              </Text>
            </HStack>
            <AccordionIcon />
          </AccordionButton>
        </h2>
        <AccordionPanel p={4} pt={0}>
          <Text textStyle="text/sm" color="neutral.600">
            This check uses the xpubs and derivation paths from you multisig setup provided by you.
          </Text>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  )
}

function ConnectColdcardWallet({ claim }: { claim: ClaimDto }) {
  const navigate = useNavigate()

  const [wizardStep, setWizardStep] = useState(1)
  const [model, setModel] = useState<ColdcardModel>()
  const [connectionMethod, setConnectionMethod] = useState<keyof typeof ColdcardConnectionMethods>()
  const [coldcardJson, setColdcardJson] = useState<ColdcardGenericJsonFile>()

  const isQrFlow = model === 'Q'

  const goBack = () => {
    if (wizardStep === 1) {
      void navigate(`/multisig/${claim.id}`)
      return
    }
    setWizardStep((prev) => prev - 1)
  }
  const goForward = () => {
    if (wizardStep === 7) {
      void navigate(`/multisig/${claim.id}`)
      return
    }
    setWizardStep((prev) => prev + 1)
  }

  return (
    <ClaimConnectionWrapper>
      <Box>
        {/* Steps 1-2 shared (intro + model selection), step 3 (connection method) only for MicroSD flow */}
        {wizardStep <= (isQrFlow ? 2 : 3) && (
          <ColdcardConnectionInfo
            step={wizardStep}
            onBack={goBack}
            onNext={goForward}
            setModel={setModel}
            setConnectionMethod={setConnectionMethod}
          />
        )}

        {/* QR flow: when model=Q, steps 3-5 map to QR steps 1-3 (intro, instructions, scan) */}
        {isQrFlow && wizardStep >= 3 && wizardStep <= 5 && (
          <ColdcardQrConnectionSteps
            step={wizardStep - 2}
            onBack={goBack}
            onNext={goForward}
            coldcardJson={coldcardJson ?? null}
            setColdcardJson={(json) => {
              setColdcardJson(json)
            }}
            selectedWallet={null}
            setSelectedWallet={() => {}}
            isStep4Loading={false}
            handleAccountSelectConfirm={() => {}}
          />
        )}

        {/* QR flow step 6: xpub matching (reuses existing component) */}
        {isQrFlow &&
          wizardStep === 6 &&
          (!coldcardJson ? (
            <RequiredDataMissing />
          ) : (
            <ColdcardMultisigStep6 claim={claim} model={model} coldcardJson={coldcardJson} />
          ))}

        {/* MicroSD flow: steps 4-6 for non-Q models (unchanged) */}
        {!isQrFlow &&
          wizardStep === 4 &&
          (!model || !connectionMethod ? (
            <RequiredDataMissing />
          ) : (
            <Step4
              model={model}
              connectionMethod={connectionMethod}
              onBack={goBack}
              onNext={goForward}
              onSwitchToAirgapping={() => {
                setConnectionMethod('airgapping')
              }}
            />
          ))}

        {!isQrFlow &&
          wizardStep === 5 &&
          (!model ? (
            <RequiredDataMissing />
          ) : (
            <Step5
              model={model}
              coldcardJson={coldcardJson ?? null}
              setColdcardJson={setColdcardJson}
              onBack={goBack}
              onNext={goForward}
            />
          ))}

        {!isQrFlow &&
          wizardStep === 6 &&
          (!model || !coldcardJson ? (
            <RequiredDataMissing />
          ) : (
            <ColdcardMultisigStep6 claim={claim} model={model} coldcardJson={coldcardJson} />
          ))}
      </Box>
    </ClaimConnectionWrapper>
  )
}

function ConnectKeystoneWallet({ claim }: { claim: ClaimDto }) {
  const navigate = useNavigate()

  const [wizardStep, setWizardStep] = useState(1)
  const [keystoneJson, setKeystoneJson] = useState<KeystoneExportFile>()

  const goBack = (): void => {
    if (wizardStep === 1) {
      void navigate(`/multisig/${claim.id}`)
    } else {
      setWizardStep((prev) => prev - 1)
    }
  }
  const goForward = (): void => {
    setWizardStep((prev) => prev + 1)
  }

  return (
    <ClaimConnectionWrapper>
      <Box>
        {/* Steps 1-3: QR connection steps (intro, export instructions, scan) */}
        {wizardStep >= 1 && wizardStep <= 3 && (
          <KeystoneQrConnectionSteps
            step={wizardStep}
            onBack={goBack}
            onNext={goForward}
            keystoneJson={keystoneJson ?? null}
            setKeystoneJson={(json) => {
              setKeystoneJson(json)
            }}
            selectedWallet={null}
            setSelectedWallet={() => {}}
            isStep4Loading={false}
            handleAccountSelectConfirm={() => {}}
          />
        )}

        {/* Step 4: xpub matching */}
        {wizardStep === 4 &&
          (!keystoneJson ? (
            <RequiredDataMissing />
          ) : (
            <KeystoneMultisigXpubCheck claim={claim} keystoneJson={keystoneJson} />
          ))}
      </Box>
    </ClaimConnectionWrapper>
  )
}

function KeystoneMultisigXpubCheck({ claim, keystoneJson }: { claim: ClaimDto; keystoneJson: KeystoneExportFile }) {
  async function getXpubFromKeystone(): Promise<Result<Xpub, Error>> {
    return getXpubFrom({
      claim,
      getXpubForPath: asyncFn(async (derivationPath) => getBitcoinXpubFromKeystoneExport(derivationPath, keystoneJson)),
      deviceType: 'keystone',
    })
  }

  return (
    <GenericCheckWalletXpub
      claim={claim}
      keystoreMetadata={{ label: 'Keystone Wallet', walletType: 'keystone' }}
      getXpubFromDevice={getXpubFromKeystone}
      media={<FloatingKeystoneImage />}
      getDeviceModel={async () => 'Keystone'}
    />
  )
}

function ColdcardMultisigStep6({
  model,
  claim,
  coldcardJson,
}: {
  model: ColdcardModel
  claim: ClaimDto
  coldcardJson: ColdcardGenericJsonFile
}) {
  async function getXpubFromColdcard(): Promise<Result<Xpub, Error>> {
    return getXpubFrom({
      claim,
      getXpubForPath: asyncFn(async (derivationPath) => getBitcoinXpubFromColdcardExport(derivationPath, coldcardJson)),
      deviceType: 'coldcard',
    })
  }

  return (
    <GenericCheckWalletXpub
      claim={claim}
      keystoreMetadata={{ label: 'Coldcard Wallet', walletType: 'coldcard' }}
      getXpubFromDevice={getXpubFromColdcard}
      media={<ColdcardModelImage model={model} />}
      getDeviceModel={async () => model}
    />
  )
}
