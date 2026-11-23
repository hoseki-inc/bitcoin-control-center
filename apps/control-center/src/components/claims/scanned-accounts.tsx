import { Icon, Stack, Text } from '@chakra-ui/react'
import {
  AccountsList,
  type HardwareWallet,
  IconWrapper,
  ScanningInProgress,
  SingleAccount,
} from '@hoseki/packages/ui/wallet-ui'
import { CircleXIcon } from 'lucide-react'
import { type ClaimError, ClaimErrorMessage } from './claim-error-message'

export function findMatchingWallet(
  wallets: readonly HardwareWallet[],
  selectedWallet: HardwareWallet | null,
): HardwareWallet | null {
  if (!selectedWallet) {
    return null
  }
  const selectedDescriptor = selectedWallet.account.descriptor()
  return wallets.find((wallet) => wallet.account.descriptor() === selectedDescriptor) ?? null
}

export function ScannedAccounts({
  isLoading,
  isFetching,
  error,
  wallets,
  selectedWallet,
  setSelectedWallet,
  onRetry,
}: {
  isLoading: boolean
  isFetching: boolean
  error: ClaimError | null
  wallets: HardwareWallet[]
  selectedWallet: HardwareWallet | null
  setSelectedWallet: (wallet: HardwareWallet | null) => void
  onRetry: () => void
}): JSX.Element {
  if (isLoading || isFetching) {
    return <ScanningInProgress />
  }

  if (error) {
    return <ClaimErrorMessage error={error} onRetry={onRetry} />
  }

  const matchingWallet = findMatchingWallet(wallets, selectedWallet)

  if (wallets.length === 1 && wallets[0]) {
    const displayWallet =
      selectedWallet && matchingWallet ? { ...wallets[0], displayName: selectedWallet.displayName } : wallets[0]
    return <SingleAccount wallet={displayWallet} setWallet={setSelectedWallet} />
  }

  if (wallets.length > 1) {
    const matchedSelection = matchingWallet ? selectedWallet : null
    const displayWallets = matchedSelection
      ? wallets.map((wallet) =>
          wallet.account.descriptor() === matchedSelection.account.descriptor()
            ? { ...wallet, displayName: matchedSelection.displayName }
            : wallet,
        )
      : wallets
    return <AccountsList wallets={displayWallets} selectedWallet={matchedSelection} setWallet={setSelectedWallet} />
  }

  return (
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
  )
}
