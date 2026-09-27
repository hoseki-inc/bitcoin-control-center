export const TREZOR_ORIGIN = 'https://connect.trezor.io'

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.username || url.password ? null : url
  } catch {
    return null
  }
}

export function isAppUrl(value: string, origin: string): boolean {
  return parseUrl(value)?.origin === origin
}

export function isTrezorPopup(value: string): boolean {
  const url = parseUrl(value)
  return url?.origin === TREZOR_ORIGIN && url.pathname === '/9/popup.html'
}

export function isExternalUrl(value: string): boolean {
  const url = parseUrl(value)
  return url !== null && ['https:', 'http:', 'mailto:'].includes(url.protocol)
}

export function isTrezorDevice(device: { vendorId: number; productId: number }): boolean {
  // The device filters used by the installed Trezor Connect SDK.
  return (
    (device.vendorId === 0x534c && device.productId === 0x0001) ||
    (device.vendorId === 0x1209 && [0x53c0, 0x53c1].includes(device.productId))
  )
}
