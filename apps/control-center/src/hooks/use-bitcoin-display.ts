import { bitcoinDisplayUnit } from '../lib/bitcoin-display'
import { useLocalSetting } from './use-local-settings'

export function useBitcoinDisplay(): ReturnType<typeof useLocalSetting> & {
  unit: ReturnType<typeof bitcoinDisplayUnit>
} {
  const setting = useLocalSetting('bitcoin_display_unit')
  return { ...setting, unit: bitcoinDisplayUnit(setting.data) }
}
