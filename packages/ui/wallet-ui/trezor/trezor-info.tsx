import { Button, Text, chakra } from '@chakra-ui/react'
import type { Result } from '@hoseki/packages/result'
import { useState } from 'react'
import { HardwareWalletError } from '../../../ui/wallet-ui'
import type { HardwareDeviceError } from '../../../wallet'
import { HowDoesThisWork } from '../../design-system'
import { WaitingOnDevice } from '../waiting-on-device'
import { WalletAnimation } from '../wallet-animation'
import { WizardFooter } from '../wizard-footer'

type TrezorInfoStep = 'device-details' | 'account-selection'

export function TrezorInfo({
  onBack,
  onConnectTrezor,
  step = 'account-selection',
}: {
  step?: TrezorInfoStep
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
            // A new click lets Trezor Suite Web open its window again, e.g. after the browser blocked it
            void connectTrezor()
          }}
        />
      )}

      <WalletAnimation animation="trezorPlugIn" />

      {accountSelectionInProgress ? (
        <WaitingOnDevice
          mt={6}
          message={
            step === 'device-details'
              ? 'Allow Bitcoin Control Center to read your device details in Trezor Suite.'
              : 'Awaiting account selection via Trezor Connect SDK...'
          }
        />
      ) : (
        <TrezorInfoCopy step={step} />
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

export function TrezorInfoCopy({ step = 'device-details' }: { step?: TrezorInfoStep }): JSX.Element {
  if (step === 'account-selection') {
    return (
      <>
        <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
          Choose Your Trezor Account
        </Text>
        <Text textStyle="text/md" color="neutral.900">
          Click &apos;Next&apos; to choose the Bitcoin account you want to verify in Trezor Suite, then come back to
          this page.
        </Text>
      </>
    )
  }

  return (
    <>
      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Verifying Ownership With Your Trezor
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        To start verifying ownership, connect your Trezor and unlock it.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        We&apos;ll guide you through each step—just follow the on-screen instructions. Your Trezor will verify ownership
        while your keys remain safely stored on your device.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Once your Trezor is connected and unlocked, click &apos;Next&apos;.
      </Text>
      <HowDoesThisWork>
        <>
          We use the official{' '}
          <chakra.a href="https://connect.trezor.io/10/" textDecoration="underline" fontWeight="medium" target="_blank">
            Trezor Connect SDK
          </chakra.a>{' '}
          to securely connect to your hardware wallet.
        </>
      </HowDoesThisWork>
    </>
  )
}
