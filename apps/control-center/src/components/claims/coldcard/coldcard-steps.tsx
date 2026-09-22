import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  HStack,
  Icon,
  Stack,
  type StackProps,
  Text,
  chakra,
} from '@chakra-ui/react'
import type { Address } from '@hoseki/packages/bitcoin'
import {
  Alert,
  Animations,
  FileDropReader,
  type FileDropState,
  HowDoesThisWork,
  LabelWithTooltip,
} from '@hoseki/packages/ui/design-system'
import { greenCheckCircle } from '@hoseki/packages/ui/prove-verify-ui'
import {
  AccountsList,
  type ColdcardGenericJsonFile,
  type ColdcardModel,
  ColdcardModels,
  type HardwareWallet,
  IconWrapper,
  NavigationArrows,
  type ParsedSignatureFile,
  ScanningInProgress,
  SignAddressAndMessageInfo,
  SigningInfoStep1,
  SingleAccount,
  WalletAnimation,
  WalletFloatingImage,
  WizardFooter,
  getColdcardAnimation,
  parseGenericJsonFile,
  parseSignatureFile,
} from '@hoseki/packages/ui/wallet-ui'
import type { Result } from '@patina/core'
import Lottie from 'lottie-react'
import { CircleXIcon, CopyIcon, InfoIcon, MoveRightIcon, TriangleAlertIcon, UsbIcon, WifiOffIcon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { GenericError } from '../../errors/generic-error'
import { RequiredDataMissing } from '../../errors/required-data-missing'
import { ClaimErrorMessage } from '../claim-error-message'
import { useColdcardAccountsWithBalances } from './use-coldcard-accounts-with-balances'

export function ColdcardConnectionInfo({
  step,
  onBack,
  onNext,
  setModel,
  setConnectionMethod,
}: {
  step: number
  onBack: () => void
  onNext: () => void
  setModel: (model: ColdcardModel) => void
  setConnectionMethod: (connectionMethod: keyof typeof ColdcardConnectionMethods) => void
}): JSX.Element {
  switch (step) {
    case 1:
      return <Step1 onBack={onBack} onNext={onNext} />
    case 2:
      return (
        <Step2
          onBack={onBack}
          onNext={(model) => {
            setModel(model)
            onNext()
          }}
        />
      )
    case 3:
      return (
        <Step3
          onBack={onBack}
          onNext={(connectionMethod) => {
            setConnectionMethod(connectionMethod)
            onNext()
          }}
        />
      )
    default:
      return <GenericError title="Unexpected error" message="Invalid step" />
  }
}

export function ColdcardIndentification({
  step,
  model,
  connectionMethod,
  onBack,
  onNext,
  onSwitchToAirgapping,
  coldcardJson,
  setColdcardJson,
  selectedWallet,
  setSelectedWallet,
  isStep6Loading,
  handleAccountSelectConfirm,
}: {
  step: number
  model: ColdcardModel
  connectionMethod: keyof typeof ColdcardConnectionMethods | null
  onBack: () => void
  onNext: () => void
  onSwitchToAirgapping: () => void
  setColdcardJson: (coldcardJson: ColdcardGenericJsonFile) => void
  coldcardJson: ColdcardGenericJsonFile | null
  selectedWallet: HardwareWallet | null
  setSelectedWallet: (selectedWallet: HardwareWallet | null) => void
  isStep6Loading: boolean
  handleAccountSelectConfirm: (model: ColdcardModel) => void
}): JSX.Element {
  const commonProps = {
    model,
    onBack,
    onNext,
  } as const
  switch (step) {
    case 4:
      return connectionMethod ? (
        <Step4 connectionMethod={connectionMethod} onSwitchToAirgapping={onSwitchToAirgapping} {...commonProps} />
      ) : (
        <RequiredDataMissing connectionMethod={connectionMethod} />
      )
    case 5:
      return <Step5 coldcardJson={coldcardJson ?? null} setColdcardJson={setColdcardJson} {...commonProps} />
    case 6:
      return coldcardJson ? (
        <Step6
          coldcardJson={coldcardJson}
          selectedWallet={selectedWallet}
          setSelectedWallet={setSelectedWallet}
          isLoadingOnNext={isStep6Loading}
          {...commonProps}
          onNext={() => {
            handleAccountSelectConfirm(model)
          }}
        />
      ) : (
        <RequiredDataMissing coldcardJson={coldcardJson} />
      )
    case 7:
      return <Step7 {...commonProps} />
    case 8:
      return <Step8 {...commonProps} />
    default:
      return <GenericError title="Unexpected error" message="Invalid step" />
  }
}

function Step1({ onNext, onBack, ...rest }: { onNext: () => void; onBack: () => void } & StackProps) {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation('MK4', 'coldcardWhatYouNeed')} />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Verifying Ownership With Your COLDCARD
      </Text>

      <Text textStyle="text/md" color="neutral.900">
        To verify ownership with your COLDCARD, you'll securely prove control of your keys by signing a message
        offline—a 100% air-gapped process that keeps your private keys safe.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        We'll guide you through each step—just follow the on-screen instructions.
      </Text>
      <Box>
        <Text textStyle="text/md" color="neutral.900" fontWeight={500}>
          You'll need:
        </Text>
        <chakra.ul ml={8} textStyle="text/md" color="neutral.900" fontWeight={400}>
          <li>A MicroSD card</li>
          <li>Your computer</li>
          <li>Your COLDCARD device</li>
        </chakra.ul>
      </Box>

      <HowDoesThisWork>We use COLDCARD's native offline message signing process.</HowDoesThisWork>

      <NavigationArrows onForward={onNext} />

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
      />
    </Stack>
  )
}

function ColdcardSelectionBox({ name, image, onClick }: { name: string; image: ReactNode; onClick: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const clickAnimationInSeconds = 0.2

  return (
    <Box
      ref={boxRef}
      display="flex"
      alignItems="center"
      justifyContent="center"
      flex={1}
      minH="250px"
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="4px"
      textAlign="center"
      onClick={() => {
        const box = boxRef.current
        if (!box) {
          return
        }

        box.classList.add('active')
        setTimeout(() => {
          box.classList.remove('active')
          onClick()
        }, clickAnimationInSeconds * 1000)
      }}
      _hover={{ cursor: 'pointer', bgColor: 'neutral.50' }}
      sx={Animations.scaleAndGlow(clickAnimationInSeconds)}
    >
      <Stack gap={4} alignItems="center">
        {image}
        <Text textStyle="label/md" fontWeight={500}>
          {name}
        </Text>
      </Stack>
    </Box>
  )
}

function Step2({
  onBack,
  onNext,
  ...rest
}: { onBack: () => void; onNext: (model: ColdcardModel) => void } & StackProps) {
  return (
    <Stack pt={16} gap={4} {...rest}>
      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        First, We Need To Understand Your Setup
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        What type of COLDCARD device do you have?
      </Text>
      <HStack gap={4}>
        {Object.entries(ColdcardModels).map(([key, { name, imageSrc, imageAlt }]) => (
          <ColdcardSelectionBox
            key={key}
            name={name}
            image={<chakra.img src={imageSrc} alt={imageAlt} h="150px" mx="auto" />}
            onClick={() => {
              onNext(key as ColdcardModel)
            }}
          />
        ))}
      </HStack>

      <NavigationArrows onBack={onBack} />
    </Stack>
  )
}

export const ColdcardConnectionMethods = {
  airgapping: {
    name: 'By Airgapping',
    icon: <WifiOffIcon />,
  },
  usb: {
    name: 'With USB',
    icon: <UsbIcon />,
  },
}

function Step3({
  onBack,
  onNext,
  ...rest
}: { onBack: () => void; onNext: (connectionMethod: keyof typeof ColdcardConnectionMethods) => void } & StackProps) {
  return (
    <Stack pt={16} gap={4} {...rest}>
      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        First, We Need To Understand Your Setup
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        How do you connect to your COLDCARD?
      </Text>
      <HStack gap={4}>
        {Object.entries(ColdcardConnectionMethods).map(([key, { name, icon }]) => (
          <ColdcardSelectionBox
            key={key}
            name={name}
            image={icon}
            onClick={() => {
              onNext(key as keyof typeof ColdcardConnectionMethods)
            }}
          />
        ))}
      </HStack>

      <NavigationArrows onBack={onBack} />
    </Stack>
  )
}

export function ColdcardModelImage({ model }: { model: ColdcardModel }): JSX.Element {
  const coldcardModel = ColdcardModels[model]
  const { imageSrc, imageAlt } = coldcardModel

  return <WalletFloatingImage href={imageSrc} alt={imageAlt} mb={4} />
}

export function Step4({
  model,
  connectionMethod,
  onBack,
  onNext,
  onSwitchToAirgapping,
  ...rest
}: {
  model: ColdcardModel
  connectionMethod: keyof typeof ColdcardConnectionMethods
  onBack: () => void
  onNext: () => void
  onSwitchToAirgapping: () => void
} & StackProps): JSX.Element {
  if (connectionMethod !== 'airgapping') {
    return (
      <Stack gap={4} pt={16} {...rest}>
        <ColdcardModelImage model={model} />

        <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
          COLDCARD Setup Requires a MicroSD Card
        </Text>
        <Text textStyle="text/md" color="neutral.900">
          To verify your COLDCARD ownership with our guided setup, you'll need a MicroSD card to securely transfer data.
          USB connections aren't supported for COLDCARD at this time.
        </Text>
        <Text textStyle="text/md" color="neutral.900">
          Don't have a microSD card? You can also{' '}
          <Link to="/accounts/verify/advanced" style={{ textDecoration: 'underline' }}>
            verify manually
          </Link>{' '}
          by signing a message in your wallet and submitting the signature.
        </Text>
        <Text textStyle="text/md" color="neutral.900">
          Click 'Next' to begin with a MicroSD card.
        </Text>

        <WizardFooter
          leftButton={
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
          }
          rightButton={<Button onClick={onSwitchToAirgapping}>Next</Button>}
        />
      </Stack>
    )
  }

  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardExportWallet')} />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Next, Let's Connect Your Wallet
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        To identify the Bitcoin you're claiming, we need your wallet export from your device.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Power on your COLDCARD, enter your PIN, and insert a MicroSD card. Once ready, navigate to:
      </Text>
      <HStack>
        <ColdcardMenuPill text={model === 'MK2/MK3' ? 'Advanced' : 'Advanced/Tools'} withArrow />
        {model === 'MK2/MK3' && <ColdcardMenuPill text="MicroSD Card" withArrow />}
        <ColdcardMenuPill text="Export Wallet" withArrow />
        <ColdcardMenuPill text="Generic JSON" />
      </HStack>
      <Text textStyle="text/md" color="neutral.900">
        Select Generic JSON to save your export to the MicroSD card. We'll use this file to connect your wallet.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Once saved, click 'Next' to continue.
      </Text>
      <Alert bgColor="neutral.50">
        <HStack>
          <Box>
            <InfoIcon width="20px" height="20px" />
          </Box>
          <Text color="neutral.800" fontWeight="500" flexGrow="1">
            If prompted to select an account number, choose the one for your wallet (typically "0").
          </Text>
        </HStack>
      </Alert>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={<Button onClick={onNext}>Next</Button>}
      />
    </Stack>
  )
}

export const validIcon = (
  <Lottie animationData={greenCheckCircle} loop={false} autoplay={true} style={{ height: '32px', width: '32px' }} />
)

export function Step5({
  model,
  coldcardJson,
  setColdcardJson,
  onBack,
  onNext,
  ...rest
}: {
  model: ColdcardModel
  coldcardJson: ColdcardGenericJsonFile | null
  setColdcardJson: (json: ColdcardGenericJsonFile) => void
  onBack: () => void
  onNext: () => void
} & StackProps): JSX.Element {
  const [fileState, setFileState] = useState<FileDropState>('ready')

  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardMicroSdIntoLaptop')} />

      <Text textStyle="text/2xl" fontWeight="medium">
        Then, Upload Your Wallet Export
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Insert your MicroSD card and upload the wallet export. This lets us detect which Bitcoin accounts your COLDCARD
        controls.
      </Text>

      <Stack gap={4}>
        <FileDropReader
          readyText="Drag 'coldcard-export.json' here"
          invalidText="Invalid file. Please check your file and try again."
          validText="Click 'Connect Wallet' to continue"
          validIcon={validIcon}
          validationFn={(rawContent): Result<ColdcardGenericJsonFile, Error> => {
            return parseGenericJsonFile(rawContent)
          }}
          onValidContentRead={(parsedColdcardJson: ColdcardGenericJsonFile) => {
            setColdcardJson(parsedColdcardJson)
          }}
          acceptedFileTypes={['json']}
          status={fileState}
          onStatusChange={setFileState}
        />
        <Alert bgColor="neutral.50">
          <HStack>
            <Box>
              <InfoIcon width="20px" height="20px" />
            </Box>
            <Text color="neutral.800">
              <Text as="span" color="neutral.800" fontWeight="500">
                Security tip:
              </Text>{' '}
              Only upload this file to Bitcoin Control Center. We recommend deleting it once the process is complete.
            </Text>
          </HStack>
        </Alert>
      </Stack>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={coldcardJson && <Button onClick={onNext}>Connect Wallet</Button>}
      />
    </Stack>
  )
}

function Step6({
  model,
  coldcardJson,
  selectedWallet,
  setSelectedWallet,
  onBack,
  isLoadingOnNext,
  onNext,
  ...rest
}: {
  model: ColdcardModel
  coldcardJson: ColdcardGenericJsonFile
  selectedWallet: HardwareWallet | null
  setSelectedWallet: (wallet: HardwareWallet | null) => void
  onBack: () => void
  isLoadingOnNext: boolean
  onNext: () => void
} & StackProps) {
  const { isLoading, error, data: wallets } = useColdcardAccountsWithBalances(coldcardJson, model)

  useEffect(() => {
    if (wallets.length === 1 && wallets[0] && !selectedWallet) {
      setSelectedWallet(wallets[0])
    }
  }, [wallets, selectedWallet, setSelectedWallet])

  return (
    <Stack pt={16} gap={4} alignItems="center" {...rest}>
      <ColdcardModelImage model={model} />

      {isLoading && <ScanningInProgress />}
      {error && <ClaimErrorMessage error={error.message} />}

      {wallets[0] && wallets.length === 1 && <SingleAccount wallet={wallets[0]} setWallet={setSelectedWallet} />}

      {wallets.length > 1 && (
        <AccountsList wallets={wallets} selectedWallet={selectedWallet} setWallet={setSelectedWallet} />
      )}

      {!isLoading && wallets.length === 0 && (
        <Stack align="center" gap={2}>
          <IconWrapper>
            <Icon as={CircleXIcon} stroke="error.500" boxSize="38px" />
          </IconWrapper>
          <Text textStyle="text/2xl" fontWeight="medium" color="neutral.900">
            Scan complete.
          </Text>
          <Text textStyle="text/md" color="neutral.900">
            We were unable to find any accounts with a non-zero balance.
          </Text>
        </Stack>
      )}

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={
          selectedWallet && (
            <Button onClick={onNext} isDisabled={isLoadingOnNext}>
              Yes, Continue
            </Button>
          )
        }
      />
    </Stack>
  )
}

export function Step7({
  onBack,
  onNext,
  ...rest
}: {
  onBack: () => void
  onNext: () => void
} & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation="genericProveControl" />
      <SigningInfoStep1 />
      <NavigationArrows onForward={onNext} />

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
      />
    </Stack>
  )
}

export function Step8({
  model,
  onBack,
  onNext,
  ...rest
}: {
  model: ColdcardModel
  onBack: () => void
  onNext: () => void
} & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardSignMessage')} />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
        Proving Control With Your COLDCARD
      </Text>

      <Text textStyle="text/md" color="neutral.900">
        You'll prove control by signing a unique message with your hardware wallet.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        This lets us confirm you control the private key for the Bitcoin you're claiming—without ever needing to see
        your key.
      </Text>

      <NavigationArrows onBack={onBack} onForward={onNext} />
    </Stack>
  )
}

function downloadTxtFile(content: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = window.URL.createObjectURL(blob)

  // Create a temporary link and trigger download
  const link = document.createElement('a')
  link.href = url
  link.download = 'hoseki-ownership-claim.txt'
  document.body.appendChild(link)
  link.click()

  // Cleanup
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export function Step9Ui({
  model,
  textFileContents,
  onBack,
  onNext,
  ...rest
}: {
  model: ColdcardModel
  textFileContents: string[] | undefined
  onBack: () => void
  onNext: () => void
} & StackProps): JSX.Element {
  const [canUserMoveForward, setCanUserMoveForward] = useState(false)

  const handleCopy = () => {
    setCanUserMoveForward(true)
    navigator.clipboard.writeText(textFileContents?.join('\n') ?? '').then(
      () => {
        toast.success('The text file contents was copied to the clipboard.')
      },
      (_err) => {
        toast.error('Error trying to copy the text file contents to the clipboard.')
      },
    )
  }

  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardDownloadTextFile')} />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
        Download Our Unique Message File
      </Text>

      <Text textStyle="text/md" color="neutral.900">
        To sign our unique message, download the txt file below to your MicroSD card. This includes the message you'll
        sign along with wallet identifiers used by COLDCARD to complete the signing process.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Once saved to your MicroSD card, click 'Next' to continue.
      </Text>

      <Alert status="warning">
        <HStack>
          <Icon as={TriangleAlertIcon} boxSize="20px" stroke="warning.800" />
          <Box>
            <Text color="warning.800" fontWeight={500}>
              Do not modify this file—each line is required for verification.
            </Text>
          </Box>
        </HStack>
      </Alert>

      <Stack gap={2}>
        <HStack justifyContent="space-between">
          <LabelWithTooltip
            labelText="File contents"
            tooltipText="COLDCARD message files require 3 lines: (1) Your message to sign, (2) Derivation path for the signing address (public key), and (3) Script type of the address."
            labelProps={{ fontSize: '16px', color: 'neutral.900' }}
          />
          <Link
            to="https://coldcard.com/docs/message-signing/#signing-text-file"
            style={{ textDecoration: 'underline' }}
            target="_blank"
          >
            What's this?
          </Link>
        </HStack>
        <Box>
          <Box fontFamily="'Geist Mono', monospace">
            <Box bgColor="neutral.100" px={4} py={1}>
              <HStack>
                <Text flexGrow={1} color="neutral.500" fontSize="12px">
                  .txt file contents
                </Text>
                <Text>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    border="none"
                    bgColor="neutral.100"
                    py={1}
                    px={3}
                    _focus={{ border: 'none' }}
                  >
                    <Icon as={CopyIcon} color="neutral.500" boxSize="16px" />
                  </Button>
                </Text>
              </HStack>
            </Box>
            <Box
              p={6}
              pl={0}
              bgColor="neutral.50"
              color="neutral.900"
              whiteSpace="nowrap"
              overflowX="auto"
              overflowY="hidden"
              maxWidth="100%"
              sx={{
                counterReset: 'line',
                '> div': {
                  display: 'block',
                  '&::before': {
                    counterIncrement: 'line',
                    content: 'counter(line) " "',
                    display: 'inline-block',
                    width: '2rem',
                    textAlign: 'right',
                    color: 'gray.500',
                    pr: 4,
                  },
                },
              }}
            >
              {textFileContents?.map((line, i) => (
                <Box key={i}>{line}</Box>
              ))}
            </Box>
          </Box>
          <Box textAlign="right" mt={2}>
            <Button
              variant="outline"
              onClick={() => {
                downloadTxtFile(textFileContents?.join('\n') ?? '')
                setCanUserMoveForward(true)
              }}
              size="sm"
            >
              Download
            </Button>
          </Box>
        </Box>
      </Stack>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={
          <Button
            onClick={() => {
              if (canUserMoveForward) {
                onNext()
                return
              }
              toast.error('File not downloaded or copied', {
                description: 'Please download or copy the file contents before continuing.',
              })
            }}
          >
            Next
          </Button>
        }
      />
    </Stack>
  )
}

export function Step10({
  model,
  address,
  messageTextToSign,
  signingPath,
  onBack,
  onNext,
  ...rest
}: {
  model: ColdcardModel
  address: Address
  messageTextToSign: string
  signingPath: string | null
  onBack: () => void
  onNext: () => void
} & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardSignTextFile')} />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
        Sign The Unique Message File On Your COLDCARD
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Power on your COLDCARD, enter your PIN, and insert the MicroSD card. Once ready, navigate to:
      </Text>

      <HStack>
        <ColdcardMenuPill text={model === 'MK2/MK3' ? 'Advanced' : 'Advanced/Tools'} withArrow />
        <ColdcardMenuPill text={model === 'MK2/MK3' ? 'MicroSD Card' : 'File Management'} withArrow />
        <ColdcardMenuPill text="Sign Text File" />
      </HStack>

      <Text textStyle="text/md" color="neutral.900">
        Select hoseki-ownership-claim.txt and press Enter. This will generate a hoseki-ownership-claim-signed.txt file
        and save it to your MicroSD card.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Once the file is signed, you can power off your COLDCARD and click 'Next' to continue.
      </Text>

      <Accordion allowToggle>
        <AccordionItem>
          <h2>
            <AccordionButton>
              Signing Details
              <AccordionIcon />
            </AccordionButton>
          </h2>
          <AccordionPanel>
            <SignAddressAndMessageInfo
              messageTextToSign={messageTextToSign}
              address={address}
              signingPath={signingPath}
            />
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={<Button onClick={onNext}>Next</Button>}
      />
    </Stack>
  )
}

function ColdcardMenuPill({ text, withArrow = false }: { text: string; withArrow?: boolean }) {
  return (
    <>
      <Text textStyle="text/md" color="neutral.900" p={1} bgColor="neutral.50" borderRadius="4px" fontWeight={500}>
        {text}
      </Text>
      {withArrow && (
        <span>
          <MoveRightIcon />
        </span>
      )}
    </>
  )
}

export function Step11Ui({
  model,
  signatureFile,
  setSignatureFile,
  fileState,
  setFileState,
  onBack,
  onProveControl,
  ...rest
}: {
  model: ColdcardModel
  signatureFile: ParsedSignatureFile | null
  setSignatureFile: (signatureFile: ParsedSignatureFile | null) => void
  fileState: FileDropState
  setFileState: (fileState: FileDropState) => void
  onBack: () => void
  onProveControl: () => void
} & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardMicroSdIntoLaptop')} />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
        Upload The Signed Message File
      </Text>

      <Text textStyle="text/md" color="neutral.900">
        The signed message file provides what we need to verify your control of the keys and the Bitcoin they secure.
      </Text>

      <Box>
        <FileDropReader
          readyText="Drag 'hoseki-ownership-claim-signed.txt' here"
          invalidText="Invalid file. Please check your file and try again."
          validText="Click 'Prove Control' to verify ownership and finalize your claim."
          validationFn={(rawContent): Result<ParsedSignatureFile, Error> => {
            return parseSignatureFile(rawContent)
          }}
          onValidContentRead={(sigFile: ParsedSignatureFile) => {
            setSignatureFile(sigFile)
          }}
          acceptedFileTypes={['txt']}
          status={fileState}
          onStatusChange={setFileState}
          validIcon={validIcon}
        />
      </Box>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={signatureFile && <Button onClick={onProveControl}>Prove Control</Button>}
      />
    </Stack>
  )
}
