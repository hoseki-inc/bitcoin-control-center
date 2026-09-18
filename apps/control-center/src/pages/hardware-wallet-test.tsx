import { Button, HStack, Stack, Text, Textarea } from '@chakra-ui/react'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { useState } from 'react'
import { trezorService } from '../components/claims/trezor/trezor-service-singleton'
import { useLedgerStore } from '../hooks/use-ledger-store'

export function HardwareWalletTestPage(): JSX.Element {
  const [json, setJson] = useState<object | null>(null)
  const initLedger = useLedgerStore((state) => state.init)
  const deviceModel = useLedgerStore((state) => state.deviceModel)

  return (
    <Stack gap={4} py={8}>
      <Text textStyle="text/4xl">Hardware Wallet Test Page</Text>

      <HStack>
        <Button
          onClick={async () => {
            setJson(null)

            const features = (await trezorService.getFeatures()).expect('Expect this to work on a test page')
            setJson({
              label: features.label,
              model: features.model,
              internal_model: features.internal_model,
            })
          }}
        >
          Show Trezor Device Details
        </Button>
        <Button
          onClick={async () => {
            setJson(null)

            await initLedger()
            try {
              const model = deviceModel?.productName ?? 'Unknown'
              setJson({ model })
            } catch {
              setJson({ error: 'Error, try one more time' })
            }
          }}
        >
          Show Ledger Device Details
        </Button>
      </HStack>

      <Textarea
        placeholder="Click a button above when the device is connected"
        defaultValue={json ? JSON.stringify(json, null, 2) : ''}
        rows={10}
        {...monoInputProps}
      />
    </Stack>
  )
}
