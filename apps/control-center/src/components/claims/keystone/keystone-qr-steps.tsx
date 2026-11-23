import { Box, Button, Stack, type StackProps, Text, chakra } from '@chakra-ui/react'
import { HowDoesThisWork } from '@hoseki/packages/ui/design-system'
import {
  FloatingKeystoneImage,
  type HardwareWallet,
  type KeystoneExportFile,
  NavigationArrows,
  WalletAnimation,
  WizardFooter,
  parseKeystoneExport,
} from '@hoseki/packages/ui/wallet-ui'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BBQrScanner } from '../../qr/bbqr-scanner'
import { ScannedAccounts, findMatchingWallet } from '../scanned-accounts'
import { useKeystoneAccountsWithBalances } from './use-keystone-accounts-with-balances'

// ---------------------------------------------------------------------------
// QR Connection Orchestrator
// ---------------------------------------------------------------------------

export function KeystoneQrConnectionSteps({
  step,
  onBack,
  onNext,
  keystoneJson,
  setKeystoneJson,
  selectedWallet,
  setSelectedWallet,
  isStep4Loading,
  handleAccountSelectConfirm,
}: {
  step: number
  onBack: () => void
  onNext: () => void
  keystoneJson: KeystoneExportFile | null
  setKeystoneJson: (json: KeystoneExportFile) => void
  selectedWallet: HardwareWallet | null
  setSelectedWallet: (wallet: HardwareWallet | null) => void
  isStep4Loading: boolean
  handleAccountSelectConfirm: () => void
}): JSX.Element {
  switch (step) {
    case 1:
      return <QrIntro onBack={onBack} onNext={onNext} />
    case 2:
      return <QrExportInstructions onBack={onBack} onNext={onNext} />
    case 3:
      return (
        <QrScanWalletExport
          onBack={onBack}
          onComplete={(json) => {
            setKeystoneJson(json)
            requestAnimationFrame(() => {
              onNext()
            })
          }}
        />
      )
    case 4:
      return keystoneJson ? (
        <AccountSelectionStep
          keystoneJson={keystoneJson}
          selectedWallet={selectedWallet}
          setSelectedWallet={setSelectedWallet}
          isLoadingOnNext={isStep4Loading}
          onBack={onBack}
          onNext={handleAccountSelectConfirm}
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
      <WalletAnimation animation="keystoneAnimation" />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Verifying Ownership With Your Keystone
      </Text>

      <Text textStyle="text/md" color="neutral.900">
        To verify ownership with your Keystone, you&apos;ll securely prove control of your keys by scanning QR codes —
        fully air-gapped.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        We&apos;ll guide you through each step — just follow the on-screen instructions.
      </Text>
      <Box>
        <Text textStyle="text/md" color="neutral.900" fontWeight={500}>
          You&apos;ll need:
        </Text>
        <chakra.ul ml={8} textStyle="text/md" color="neutral.900" fontWeight={400}>
          <li>Your Keystone device</li>
          <li>A webcam on this computer</li>
        </chakra.ul>
      </Box>

      <HowDoesThisWork>
        We use your Keystone&apos;s built-in QR scanner and display for a fully air-gapped process.
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
  onBack,
  onNext,
  ...rest
}: {
  onBack: () => void
  onNext: () => void
} & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation="keystoneAnimation" />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Display Your Wallet Export
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        To identify the Bitcoin you&apos;re claiming, we need your wallet export displayed as a QR code on your
        Keystone.
      </Text>
      {/* TODO: Add Keystone-specific menu navigation instructions once known */}
      <Text textStyle="text/md" color="neutral.900">
        Navigate to your wallet export option on your Keystone device and display the QR code.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Once the QR is displayed, click &apos;Ready to Scan&apos; to continue.
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
  onBack,
  onComplete,
  ...rest
}: {
  onBack: () => void
  onComplete: (json: KeystoneExportFile) => void
} & StackProps): JSX.Element {
  const [error, setError] = useState<string>()

  function handleBBQrComplete(data: Uint8Array): void {
    try {
      const text = new TextDecoder().decode(data)
      console.log('[Keystone QR Scan] Raw BBQr data:', text)
      const result = parseKeystoneExport(text)
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
      console.log('[Keystone QR Scan] Raw plain QR data:', text)
      const result = parseKeystoneExport(text)
      if (result.isOk()) {
        onComplete(result.unwrap())
      } else {
        setError('Scanned QR does not contain a valid wallet export.')
        toast.error('Invalid QR code', { description: 'Expected a Keystone wallet export.' })
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
      <WalletAnimation animation="keystoneQrAnimation" />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Scan Your Wallet Export
      </Text>
      <Text textStyle="text/md" color="neutral.900" textAlign="center">
        Hold your Keystone screen in front of your webcam. We&apos;ll automatically detect and read the QR code.
      </Text>

      {error != null && error !== '' && (
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
  keystoneJson,
  selectedWallet,
  setSelectedWallet,
  onBack,
  isLoadingOnNext,
  onNext,
  ...rest
}: {
  keystoneJson: KeystoneExportFile
  selectedWallet: HardwareWallet | null
  setSelectedWallet: (wallet: HardwareWallet | null) => void
  onBack: () => void
  isLoadingOnNext: boolean
  onNext: () => void
} & StackProps): JSX.Element {
  const { isLoading, isFetching, error, data: wallets, refetch } = useKeystoneAccountsWithBalances(keystoneJson)
  const isScanning = isLoading || isFetching
  const matchingSelectedWallet = findMatchingWallet(wallets, selectedWallet)

  useEffect(() => {
    if (isScanning || error) {
      return
    }
    if (matchingSelectedWallet) {
      return
    }
    if (wallets.length === 1 && wallets[0]) {
      setSelectedWallet(wallets[0])
    } else if (selectedWallet) {
      setSelectedWallet(null)
    }
  }, [isScanning, error, wallets, selectedWallet, matchingSelectedWallet, setSelectedWallet])

  return (
    <Stack pt={16} gap={4} alignItems="center" {...rest}>
      <FloatingKeystoneImage />

      <ScannedAccounts
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        wallets={wallets}
        selectedWallet={selectedWallet}
        setSelectedWallet={setSelectedWallet}
        onRetry={() => {
          void refetch()
        }}
      />

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={
          !isScanning &&
          !error &&
          wallets.length > 0 &&
          matchingSelectedWallet && (
            <Button onClick={onNext} isDisabled={isLoadingOnNext}>
              Yes, Continue
            </Button>
          )
        }
      />
    </Stack>
  )
}
