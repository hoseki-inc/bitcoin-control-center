import { Button, Text, chakra } from '@chakra-ui/react'
import { WalletAnimation, WizardFooter } from '..'
import { HowDoesThisWork } from '../../design-system'
import { HardwareWalletError } from '../hardware-wallet-error'

export function LedgerConnectionInfoUI({
  onBack,
  onContinue,
  isLoading,
  error,
}: {
  onBack?: () => void
  onContinue: () => void
  isLoading: boolean
  error: Error | null
}): JSX.Element {
  return (
    <>
      {error && (
        <HardwareWalletError
          error={error}
          mt={4}
          onRetry={() => {
            window.location.reload()
          }}
        />
      )}

      <WalletAnimation animation="ledgerPlugIn" />

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Verifying Ownership With Your Ledger
      </Text>

      <Text textStyle="text/md" color="neutral.900">
        To start verifying ownership, connect your Ledger via USB, unlock it with your PIN, and open the Bitcoin app.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        We&apos;ll guide you through each step—just follow the on-screen instructions. Your Ledger will verify ownership
        while your keys remain safely stored on your device.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Once your Ledger is connected and the Bitcoin app is open, click &apos;Next&apos;. If prompted, please accept
        any browser notifications allowing Bitcoin Control Center to securely connect with your device.
      </Text>

      <HowDoesThisWork>
        <>
          We use the official{' '}
          <chakra.a
            href="https://developers.ledger.com/docs/device-interaction/getting-started"
            textDecoration="underline"
            fontWeight="medium"
            target="_blank"
          >
            Ledger Live SDK
          </chakra.a>{' '}
          to securely connect to your hardware wallet.
        </>
      </HowDoesThisWork>

      <WizardFooter
        leftButton={
          onBack && (
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
          )
        }
        rightButton={
          <Button onClick={onContinue} isLoading={isLoading}>
            Next
          </Button>
        }
      />
    </>
  )
}
