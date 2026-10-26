import { Button, Stack, Text } from '@chakra-ui/react'
// Lottie runs animation expressions with eval: only render bundled animations.
import Lottie from 'lottie-react'
import type { Dispatch, SetStateAction } from 'react'
import { AnimatedPopInSingleBox } from '../../design-system'
import { greenCheckCircle } from '../../prove-verify-ui'
import { HardwareWalletCard } from '../hardware-wallet-card'
import { WizardFooter } from '../wizard-footer'
import { FloatingTrezorImage } from './floating-trezor-image'
import type { SelectedTrezorAccount } from './trezor-types'
import { isTrezorModel } from './trezor-utils'

export function TrezorConfirm({
  trezorAccount,
  setSelectedTrezorAccount,
  isLoadingOnContinue,
  onContinue,
  onCancel,
}: {
  trezorAccount: SelectedTrezorAccount
  setSelectedTrezorAccount: Dispatch<SetStateAction<SelectedTrezorAccount | undefined>>
  isLoadingOnContinue: boolean
  onContinue: () => void
  onCancel: () => void
}): JSX.Element {
  const model = trezorAccount.trezorFeatures?.model
  return (
    <>
      <FloatingTrezorImage modelName={model != null && isTrezorModel(model) ? model : 'One'} />

      <Stack gap={4} alignItems="center">
        <Lottie
          animationData={greenCheckCircle}
          loop={false}
          autoplay={true}
          style={{ height: '56px', width: '56px' }}
        />
        <Text textStyle="text/2xl" fontWeight="medium" color="neutral.900">
          Account Connected
        </Text>
        <Text textStyle="text/md" textAlign="center">
          Does this information look correct?
        </Text>
      </Stack>

      <AnimatedPopInSingleBox display="flex" justifyContent="center" gap={4} maxW="640px">
        <HardwareWalletCard
          wallet={trezorAccount.wallet}
          isSelected={true}
          onUpdateDisplayName={(newDisplayName) => {
            setSelectedTrezorAccount((prev?: SelectedTrezorAccount) => {
              if (!prev) {
                return prev
              }
              return {
                ...prev,
                wallet: {
                  ...prev.wallet,
                  displayName: newDisplayName,
                },
              }
            })
          }}
        />
      </AnimatedPopInSingleBox>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onCancel}>
            No, Cancel
          </Button>
        }
        rightButton={
          <Button onClick={onContinue} isLoading={isLoadingOnContinue}>
            Yes, Continue
          </Button>
        }
      />
    </>
  )
}
