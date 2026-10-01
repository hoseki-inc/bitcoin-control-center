import { Flex, Stack, Text } from '@chakra-ui/react'
// Lottie runs animation expressions with eval: only render bundled animations.
import Lottie from 'lottie-react'
import type { ReactNode } from 'react'
import { type HardwareWallet, HardwareWalletCard, TimedoutRetry } from '../'
import { AnimatedPopInBoxes, AnimatedPopInSingleBox, Spinner } from '../../design-system'
import { greenCheckCircle } from '../../prove-verify-ui'

function getWalletId(wallet: HardwareWallet) {
  return `${wallet.account.scriptType}:${wallet.accountIndex}`
}

export function ScanningInProgress(): JSX.Element {
  return (
    <Stack gap={2} textAlign="center">
      <IconWrapper>
        <Spinner h={38} w={38} />
      </IconWrapper>
      <Text textStyle="text/lg" fontWeight="medium" color="neutral.900">
        Scanning for active accounts...
      </Text>
      <TimedoutRetry />
    </Stack>
  )
}

export function SingleAccount({
  wallet,
  setWallet,
}: {
  wallet: HardwareWallet
  setWallet: (wallet: HardwareWallet | null) => void
}): JSX.Element {
  return (
    <Stack gap={4}>
      <Stack gap={2} alignItems="center">
        <IconWrapper>
          <Lottie
            animationData={greenCheckCircle}
            loop={false}
            autoplay={true}
            style={{ height: '50px', width: '50px' }}
          />
        </IconWrapper>
        <Text textStyle="text/2xl" fontWeight="medium" color="neutral.900">
          Scan complete!
        </Text>
        <Text textStyle="text/md" color="neutral.900">
          We&apos;ve found the following bitcoin account on your device. Continue with verification?
        </Text>
      </Stack>
      <AnimatedPopInSingleBox display="flex" justifyContent="center" gap={4} maxW="640px">
        <HardwareWalletCard
          wallet={wallet}
          isSelected={true}
          onUpdateDisplayName={(newDisplayName: string) => {
            setWallet({ ...wallet, displayName: newDisplayName })
          }}
        />
      </AnimatedPopInSingleBox>
    </Stack>
  )
}

export function AccountsList({
  wallets,
  selectedWallet,
  setWallet,
}: {
  wallets: HardwareWallet[]
  selectedWallet: HardwareWallet | null
  setWallet: (wallet: HardwareWallet | null) => void
}): JSX.Element {
  return (
    <Stack gap={4}>
      <Stack gap={2} alignItems="center">
        <IconWrapper>
          <Lottie
            animationData={greenCheckCircle}
            loop={false}
            autoplay={true}
            style={{ height: '50px', width: '50px' }}
          />
        </IconWrapper>
        <Text textStyle="text/2xl" fontWeight="medium" color="neutral.900">
          Scan complete!
        </Text>
        <Text textStyle="text/md" color="neutral.900">
          {selectedWallet
            ? 'Continue verification with the selected account?'
            : "We've found the following bitcoin accounts on your device. Select one to continue:"}
        </Text>
      </Stack>
      <AnimatedPopInBoxes gap={4} maxW="640px">
        {wallets.map((wallet) => {
          const isSelected = selectedWallet ? getWalletId(selectedWallet) === getWalletId(wallet) : false

          return (
            <HardwareWalletCard
              key={getWalletId(wallet)}
              wallet={wallet}
              onClick={setWallet}
              isSelected={isSelected}
              onUpdateDisplayName={(newDisplayName: string) => {
                setWallet({ ...wallet, displayName: newDisplayName })
              }}
            />
          )
        })}
      </AnimatedPopInBoxes>
    </Stack>
  )
}

// NOTE: This wraps the loading spinner, then the Lottie green checkmark.
// Without having a fixed-height, they do not line up properly due to the Lottie having built-in whitespace.
export function IconWrapper({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Flex h="60px" justify="center" alignItems="center">
      {children}
    </Flex>
  )
}
