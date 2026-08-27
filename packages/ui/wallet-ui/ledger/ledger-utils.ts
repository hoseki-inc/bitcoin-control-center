export const ledgerModels = ['Nano S', 'Nano S Plus', 'Nano X', 'Flex', 'Stax'] as const

export type LedgerModel = (typeof ledgerModels)[number]

export function isLedgerModel(model: string): model is LedgerModel {
  return ledgerModels.includes(model as LedgerModel)
}

/**
 * @see node_modules/.pnpm/@ledgerhq+devices@8.4.7/node_modules/@ledgerhq/devices/src/index.ts:24
 */
export function getLedgerModel(deviceId: string): LedgerModel | null {
  switch (deviceId) {
    case 'nanoSP':
      return 'Nano S Plus'
    case 'nanoS':
      return 'Nano S'
    case 'nanoX':
      return 'Nano X'
    case 'europa':
      return 'Flex'
    case 'stax':
      return 'Stax'
    default:
      return null
  }
}

export type HwAppBtcSignature = {
  v: number
  r: string
  s: string
}

/**
 * Encodes a signature output from `@ledgerhq/hw-app-btc` package.
 *
 * @param signature.v - The recovery parameter.
 * @param signature.r - The R component of the signature.
 * @param signature.s - The S component of the signature.
 */
export function encodeHwAppBtcSignature(signature: HwAppBtcSignature): string {
  const v = Buffer.from([27 + 4 + (signature.v & 0x01)])
  const r = Buffer.from(signature.r, 'hex')
  const s = Buffer.from(signature.s, 'hex')
  const vUint8 = new Uint8Array(v)
  const rUint8 = new Uint8Array(r)
  const sUint8 = new Uint8Array(s)
  const bUint8 = new Uint8Array(vUint8.length + rUint8.length + sUint8.length)
  bUint8.set(vUint8, 0)
  bUint8.set(rUint8, vUint8.length)
  bUint8.set(sUint8, vUint8.length + rUint8.length)
  const b = Buffer.from(bUint8)
  return b.toString('base64')
}

export type DeviceSignerKitBitcoinSignature = {
  v: number
  r: `0x${string}`
  s: `0x${string}`
}

/**
 * Encodes a signature output from `@ledgerhq/device-signer-kit-bitcoin` package.
 *
 * @param signature.v - The recovery parameter - 27 + 4 + (v & 0x01) is already applied.
 * @param signature.r - The R component of the signature - 0x prefixed.
 * @param signature.s - The S component of the signature - 0x prefixed.
 */
export function encodeDeviceSignerKitBitcoinSignature(signature: DeviceSignerKitBitcoinSignature): string {
  const v = Buffer.from(signature.v.toString(16), 'hex')
  const r = Buffer.from(signature.r.slice(2), 'hex')
  const s = Buffer.from(signature.s.slice(2), 'hex')
  const vUint8 = new Uint8Array(v)
  const rUint8 = new Uint8Array(r)
  const sUint8 = new Uint8Array(s)
  const bUint8 = new Uint8Array(vUint8.length + rUint8.length + sUint8.length)
  bUint8.set(vUint8, 0)
  bUint8.set(rUint8, vUint8.length)
  bUint8.set(sUint8, vUint8.length + rUint8.length)
  const b = Buffer.from(bUint8)
  return b.toString('base64')
}
