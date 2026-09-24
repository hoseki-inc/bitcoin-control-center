import { Button, Text, chakra } from '@chakra-ui/react'
import type { Result } from '@hoseki/packages/result'
import { useState } from 'react'
import { HardwareWalletError } from '../../../ui/wallet-ui'
import type { HardwareDeviceError } from '../../../wallet'
import { HowDoesThisWork } from '../../design-system'
import { WaitingOnDevice } from '../waiting-on-device'
import { WalletAnimation } from '../wallet-animation'
import { WizardFooter } from '../wizard-footer'

export function TrezorInfo({
  onBack,
  onConnectTrezor,
}: {
  onBack: () => void
  onConnectTrezor: () => Promise<Result<void, Error | HardwareDeviceError>>
}): JSX.Element {
  const [accountSelectionInProgress, setAccountSelectionInProgress] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  async function connectTrezor(): Promise<void> {
    setAccountSelectionInProgress(true)
    setError(null)
    try {
      const result = await onConnectTrezor()
      if (result.isErr()) {
        setError(result.unwrapErr())
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError : new Error('Unable to connect to Trezor'))
    } finally {
      setAccountSelectionInProgress(false)
    }
  }

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

      <WalletAnimation animation="trezorPlugIn" />

      {accountSelectionInProgress ? (
        <WaitingOnDevice mt={6} message="Awaiting account selection via Trezor Connect SDK..." />
      ) : (
        <TrezorInfoCopy />
      )}

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={
          <Button
            isDisabled={accountSelectionInProgress}
            onClick={() => {
              void connectTrezor()
            }}
          >
            Next
          </Button>
        }
      />
    </>
  )
}

export function TrezorInfoCopy(): JSX.Element {
  return (
    <>
      <Text as="h2" textStyle="text/2xl" color="text.primary" fontWeight="medium">
        Verifying Ownership With Your Trezor
      </Text>
      <Text textStyle="text/md" color="text.primary">
        To start verifying ownership, connect your Trezor and unlock it.
      </Text>
      <Text textStyle="text/md" color="text.primary">
        We&apos;ll guide you through each step—just follow the on-screen instructions. Your Trezor will verify ownership
        while your keys remain safely stored on your device.
      </Text>
      <Text textStyle="text/md" color="text.primary">
        Once your Trezor is connected and unlocked, click &apos;Next&apos;.
      </Text>
      <HowDoesThisWork>
        <>
          We use the official{' '}
          <chakra.a href="https://connect.trezor.io/9/" textDecoration="underline" fontWeight="medium" target="_blank">
            Trezor Connect SDK
          </chakra.a>{' '}
          to securely connect to your hardware wallet.
        </>
      </HowDoesThisWork>
    </>
  )
}
