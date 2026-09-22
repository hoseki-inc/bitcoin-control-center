import { Select } from '@chakra-ui/react'
import { Network } from '@hoseki/packages/bitcoin'

export function BitcoinNetworkSelect({
  value,
  onChange,
  isDisabled = false,
}: {
  value: Network
  onChange: (value: Network) => void
  isDisabled?: boolean
}): JSX.Element {
  return (
    <Select
      value={value.toString()}
      onChange={(e) => {
        onChange(Network.fromStringRaw(e.target.value).expect('valid enum value'))
      }}
      isDisabled={isDisabled}
    >
      {/* This is only for disambiguation between testnet and regtest, so we do not need mainnet here */}
      <option value="bitcoin_testnet">Testnet</option>
      <option value="bitcoin_regtest">Regtest</option>
    </Select>
  )
}
