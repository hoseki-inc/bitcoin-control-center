import { Button } from '@chakra-ui/react'
import { Alert } from '@hoseki/packages/ui/design-system'
import { useEffect, useState } from 'react'
import { FloatingLedgerImage, type HardwareWallet, WizardFooter, getLedgerModel } from '../'
import { AccountsList, ScanningInProgress, SingleAccount } from '../account-scanning'
import { HardwareWalletError } from '../hardware-wallet-error'
import type { LedgerDeviceModel } from './device-store'

export function LedgerScanUI({
  isLoadingOnContinue,
  onContinue,
  onBack,
  onCancel,
  walletsQuery,
  deviceModel,
}: {
  isLoadingOnContinue: boolean
  onContinue: (wallet: HardwareWallet, deviceId: string) => void
  onBack: () => void
  onCancel: () => void
  walletsQuery: {
    data: HardwareWallet[]
    isLoading: boolean
    isError: boolean
    error: Error | null
  }
  deviceModel: LedgerDeviceModel | null
}): JSX.Element {
  const [selectedWallet, setSelectedWallet] = useState<HardwareWallet | null>(null)

  useEffect(() => {
    if (walletsQuery.data?.length === 1 && walletsQuery.data[0] && !selectedWallet) {
      setSelectedWallet(walletsQuery.data[0])
    }
  }, [walletsQuery.data, selectedWallet, setSelectedWallet])

  return (
    <>
      {walletsQuery.error && (
        <HardwareWalletError
          error={walletsQuery.error}
          mt={4}
          onRetry={() => {
            window.location.reload()
          }}
        />
      )}

      {deviceModel && <FloatingLedgerImage modelName={getLedgerModel(deviceModel.id) ?? 'Nano S Plus'} />}

      {walletsQuery.isLoading && <ScanningInProgress />}

      {walletsQuery.data && walletsQuery.data.length === 1 && walletsQuery.data[0] && (
        <SingleAccount wallet={walletsQuery.data[0]} setWallet={setSelectedWallet} />
      )}
      {walletsQuery.data && walletsQuery.data.length > 1 && (
        <AccountsList wallets={walletsQuery.data} selectedWallet={selectedWallet} setWallet={setSelectedWallet} />
      )}
      {walletsQuery.data?.length === 0 && !walletsQuery.isLoading && !walletsQuery.error && (
        <Alert status="warning" title="No wallets found" />
      )}

      <WizardFooter
        leftButton={
          selectedWallet ? (
            <Button variant="outline" onClick={onCancel}>
              No, Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
          )
        }
        rightButton={
          !selectedWallet ? null : (
            <Button
              onClick={() => {
                onContinue(selectedWallet, deviceModel?.id ?? 'unknown')
              }}
              isDisabled={!selectedWallet}
              isLoading={isLoadingOnContinue}
            >
              Yes, Continue
            </Button>
          )
        }
      />
    </>
  )
}
