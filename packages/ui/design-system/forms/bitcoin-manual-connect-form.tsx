import { Box, Stack, type StackProps } from '@chakra-ui/react'
import type { Dispatch, SetStateAction } from 'react'
import type { BitcoinInput } from '../../utils'
import { AdvancedFeatureAlert } from '../feedback/advanced-feature-alert'
import { BitcoinInputFormFields } from './bitcoin-input-form-fields'

export function BitcoinManualConnect({
  bitcoinInput,
  setBitcoinInput,
  ...props
}: {
  bitcoinInput: BitcoinInput | null
  setBitcoinInput: Dispatch<SetStateAction<BitcoinInput | null>>
} & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...props}>
      <AdvancedFeatureAlert />

      <Box>
        <BitcoinInputFormFields setBitcoinInput={setBitcoinInput} defaultValues={bitcoinInput ?? undefined} />
      </Box>
    </Stack>
  )
}
