import type { Features } from '@trezor/connect-web'

export function getTrezorDisplayName(features: Pick<Features, 'model' | 'label'>): string {
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
export function getTrezorModel(model: string | null | undefined): TrezorModel | null {
  // Connect 10 exports PROTO only as a type, so match the wire values directly.
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
    case null:
    case undefined:
    default:
      return null
  }
}
