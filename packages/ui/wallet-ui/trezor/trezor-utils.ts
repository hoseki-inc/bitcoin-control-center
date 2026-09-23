import { type Features, PROTO } from '@trezor/connect-web'

export function getTrezorDisplayName(features: Features): string {
  let displayName = 'Trezor'
  if (features.model) {
    displayName += ` ${features.model}`
  }
  if (features.label != null && features.label !== '') {
    displayName += ` (${features.label})`
  }
  return displayName
}

export const trezorModels = ['One', 'T', 'Safe 3 (Bitcoin-only)', 'Safe 3', 'Safe 5'] as const
export function isTrezorModel(model: string): model is TrezorModel {
  return trezorModels.some((candidate) => candidate === model)
}
export type TrezorModel = (typeof trezorModels)[number]
/**
 * @see https://github.com/trezor/trezor-firmware/blob/main/python/src/trezorlib/models.py
 * @see https://docs.trezor.io/trezor-suite/misc/device-naming.html
 */
export function getTrezorModel(model: Features['internal_model']): TrezorModel | null {
  switch (model) {
    case PROTO.DeviceModelInternal.T1B1:
      return 'One'
    case PROTO.DeviceModelInternal.T2T1:
      return 'T'
    case PROTO.DeviceModelInternal.T2B1:
      return 'Safe 3 (Bitcoin-only)'
    case PROTO.DeviceModelInternal.T3B1:
      return 'Safe 3'
    case PROTO.DeviceModelInternal.T3T1:
      return 'Safe 5'
    default:
      return null
  }
}
