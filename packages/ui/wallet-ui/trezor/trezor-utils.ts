import type { Features } from '@trezor/connect-web'

export function getTrezorDisplayName(features: Features): string {
  let displayName = 'Trezor'
  if (features.model) {
    displayName += ` ${features.model}`
  }
  if (features.label) {
    displayName += ` (${features.label})`
  }
  return displayName
}

export const trezorModels = ['One', 'T', 'Safe 3 (Bitcoin-only)', 'Safe 3', 'Safe 5'] as const
export function isTrezorModel(model: string): model is TrezorModel {
  return trezorModels.includes(model as TrezorModel)
}
export type TrezorModel = (typeof trezorModels)[number]
/**
 * @see https://github.com/trezor/trezor-firmware/blob/main/python/src/trezorlib/models.py
 * @see https://docs.trezor.io/trezor-suite/misc/device-naming.html
 */
export function getTrezorModel(model: Features['internal_model']): TrezorModel | null {
  switch (model) {
    case 'T1B1':
      return 'One'
    case 'T2T1':
      return 'T'
    case 'T2B1':
      return 'Safe 3 (Bitcoin-only)'
    case 'T3B1':
      return 'Safe 3'
    case 'T3T1':
      return 'Safe 5'
    default:
      return null
  }
}
