import { Box, Stack, type StackProps } from '@chakra-ui/react'
import type { Dispatch, SetStateAction } from 'react'
import type { BitcoinInput } from '../../utils'
import { AdvancedFeatureAlert } from '../feedback/advanced-feature-alert'
import { BitcoinInputFormFields } from './bitcoin-input-form-fields'
import type { ScriptTypeBalances } from './script-type-radio-group'

export function BitcoinManualConnect({
  bitcoinInput,
  setBitcoinInput,
  scriptTypeBalances,
  onRawInputChange,
  ...props
}: {
  bitcoinInput: BitcoinInput | null
  setBitcoinInput: Dispatch<SetStateAction<BitcoinInput | null>>
  scriptTypeBalances?: ScriptTypeBalances
  onRawInputChange?: (raw: string) => void
} & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...props}>
      <AdvancedFeatureAlert />

      <Box>
        <BitcoinInputFormFields
          setBitcoinInput={setBitcoinInput}
          defaultValues={bitcoinInput ?? undefined}
          scriptTypeBalances={scriptTypeBalances}
          onRawInputChange={onRawInputChange}
        />
      </Box>
    </Stack>
  )
}
