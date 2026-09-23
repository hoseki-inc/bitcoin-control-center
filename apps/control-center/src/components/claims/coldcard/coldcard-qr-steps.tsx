import { Box, Button, HStack, Icon, Stack, type StackProps, Text, chakra } from '@chakra-ui/react'
import { HowDoesThisWork } from '@hoseki/packages/ui/design-system'
import {
  AccountsList,
  type ColdcardGenericJsonFile,
  type ColdcardModel,
  type HardwareWallet,
  IconWrapper,
  NavigationArrows,
  ScanningInProgress,
  SingleAccount,
  WalletAnimation,
  WizardFooter,
  getColdcardAnimation,
  parseGenericJsonFile,
} from '@hoseki/packages/ui/wallet-ui'
import { CircleXIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BBQrScanner } from '../../qr/bbqr-scanner'
import { ClaimErrorMessage } from '../claim-error-message'
import { ColdcardModelImage } from './coldcard-steps'
import { useColdcardAccountsWithBalances } from './use-coldcard-accounts-with-balances'

// ---------------------------------------------------------------------------
// QR Connection Orchestrator
// ---------------------------------------------------------------------------

export function ColdcardQrConnectionSteps({
  step,
  onBack,
  onNext,
  coldcardJson,
  setColdcardJson,
  selectedWallet,
  setSelectedWallet,
  isStep4Loading,
  handleAccountSelectConfirm,
}: {
  step: number
  onBack: () => void
  onNext: () => void
  coldcardJson: ColdcardGenericJsonFile | null
  setColdcardJson: (json: ColdcardGenericJsonFile) => void
  selectedWallet: HardwareWallet | null
  setSelectedWallet: (wallet: HardwareWallet | null) => void
  isStep4Loading: boolean
  handleAccountSelectConfirm: (model: ColdcardModel) => void
}): JSX.Element {
  const model: ColdcardModel = 'Q'

  switch (step) {
    case 1:
      return <QrIntro onBack={onBack} onNext={onNext} />
    case 2:
      return <QrExportInstructions model={model} onBack={onBack} onNext={onNext} />
    case 3:
      return (
        <QrScanWalletExport
          model={model}
          onBack={onBack}
          onComplete={(json) => {
            setColdcardJson(json)
            // Defer step advancement so React processes the JSON state update first.
            // Advancing immediately can cause a render crash with @hoseki/packages/result types.
            requestAnimationFrame(() => {
              onNext()
            })
          }}
        />
      )
    case 4:
      return coldcardJson ? (
        <AccountSelectionStep
          model={model}
          coldcardJson={coldcardJson}
          selectedWallet={selectedWallet}
          setSelectedWallet={setSelectedWallet}
          isLoadingOnNext={isStep4Loading}
          onBack={onBack}
          onNext={() => {
            handleAccountSelectConfirm(model)
          }}
        />
      ) : (
        <></>
      )
    default:
      return <></>
  }
}

// ---------------------------------------------------------------------------
// QR Step 1: Introduction
// ---------------------------------------------------------------------------

function QrIntro({ onNext, onBack, ...rest }: { onNext: () => void; onBack: () => void } & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation('Q', 'coldcardWhatYouNeed')} />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Verifying Ownership With Your COLDCARD Q
      </Text>

      <Text textStyle="text/md" color="neutral.900">
        To verify ownership with your COLDCARD Q, you'll securely prove control of your keys by scanning QR codes — no
        MicroSD card needed.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        We'll guide you through each step — just follow the on-screen instructions.
      </Text>
      <Box>
        <Text textStyle="text/md" color="neutral.900" fontWeight={500}>
          You'll need:
        </Text>
        <chakra.ul ml={8} textStyle="text/md" color="neutral.900" fontWeight={400}>
          <li>Your COLDCARD Q</li>
          <li>A webcam on this computer</li>
        </chakra.ul>
      </Box>

      <HowDoesThisWork>
        We use COLDCARD Q's built-in QR scanner and display for a fully air-gapped process.
      </HowDoesThisWork>

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

// ---------------------------------------------------------------------------
// QR Step 2: Export Instructions
// ---------------------------------------------------------------------------

function QrExportInstructions({
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
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardExportWallet')} />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Display Your Wallet Export
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        To identify the Bitcoin you're claiming, we need your wallet export displayed as a QR code on your COLDCARD Q.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Power on your COLDCARD Q, enter your PIN, and navigate to:
      </Text>
      <HStack>
        <ColdcardMenuPill text="Advanced/Tools" withArrow />
        <ColdcardMenuPill text="Export Wallet" withArrow />
        <ColdcardMenuPill text="Generic JSON" />
      </HStack>
      <Text textStyle="text/md" color="neutral.900">
        When prompted how to share, press the{' '}
        <Text as="span" fontWeight={600}>
          QR button
        </Text>{' '}
        on your device. Your COLDCARD Q will display an animated QR code.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Once the QR is displayed, click 'Ready to Scan' to continue.
      </Text>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={<Button onClick={onNext}>Ready to Scan</Button>}
      />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// QR Step 3: Scan Wallet Export
// ---------------------------------------------------------------------------

function QrScanWalletExport({
  model,
  onBack,
  onComplete,
  ...rest
}: {
  model: ColdcardModel
  onBack: () => void
  onComplete: (json: ColdcardGenericJsonFile) => void
} & StackProps): JSX.Element {
  const [error, setError] = useState<string>()

  function handleBBQrComplete(data: Uint8Array): void {
    try {
      const text = new TextDecoder().decode(data)
      const result = parseGenericJsonFile(text)
      if (result.isOk()) {
        onComplete(result.unwrap())
      } else {
        setError(result.unwrapErr().message)
        toast.error('Invalid wallet export', { description: result.unwrapErr().message })
      }
    } catch (err) {
      console.error('[QR Scan] Failed to parse wallet export:', err)
      const msg = err instanceof Error ? err.message : 'Failed to parse wallet export'
      setError(msg)
      toast.error('Failed to parse wallet export')
    }
  }

  function handlePlainScan(text: string): void {
    try {
      const result = parseGenericJsonFile(text)
      if (result.isOk()) {
        onComplete(result.unwrap())
      } else {
        setError('Scanned QR does not contain a valid wallet export.')
        toast.error('Invalid QR code', { description: 'Expected a COLDCARD wallet export.' })
      }
    } catch (err) {
      console.error('[QR Scan] Failed to parse plain QR:', err)
      const msg = err instanceof Error ? err.message : 'Failed to parse QR code'
      setError(msg)
      toast.error('Failed to parse QR code')
    }
  }

  return (
    <Stack gap={4} alignItems="center" {...rest}>
      <ColdcardModelImage model={model} />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Scan Your Wallet Export
      </Text>
      <Text textStyle="text/md" color="neutral.900" textAlign="center">
        Hold your COLDCARD Q screen in front of your webcam. We'll automatically detect and read the QR code.
      </Text>

      {error && (
        <Text textStyle="text/sm" color="error.500" textAlign="center">
          {error}
        </Text>
      )}

      <BBQrScanner onComplete={handleBBQrComplete} onPlainScan={handlePlainScan} onError={setError} onCancel={onBack} />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// QR Step 4: Account Selection
// ---------------------------------------------------------------------------

function AccountSelectionStep({
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
} & StackProps): JSX.Element {
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

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------

function ColdcardMenuPill({ text, withArrow = false }: { text: string; withArrow?: boolean }): JSX.Element {
  return (
    <>
      <Text textStyle="text/md" color="neutral.900" p={1} bgColor="neutral.50" borderRadius="4px" fontWeight={500}>
        {text}
      </Text>
      {withArrow && <Text color="neutral.400">→</Text>}
    </>
  )
}
