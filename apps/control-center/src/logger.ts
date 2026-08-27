import type { HardwareDeviceError, SupportedHardwareWallet } from '@hoseki/packages/wallet'
import pino, { type Logger } from 'pino'

export const browserLogger: Logger = pino({
  level: import.meta.env['VITE_DEBUG_MODE'] === 'true' ? 'debug' : 'info',
  browser: {
    write: {
      info({ msg, ...rest }: { msg?: unknown }) {
        console.info(msg, rest)
      },
      error({ msg, ...rest }: { msg?: unknown }) {
        console.error(msg, rest)
      },
      warn({ msg, ...rest }: { msg?: unknown }) {
        console.warn(msg, rest)
      },
      debug({ msg, ...rest }: { msg?: unknown }) {
        console.debug(msg, rest)
      },
      trace({ msg, ...rest }: { msg?: unknown }) {
        console.trace(msg, rest)
      },
    },
  },
})

export const captureHardwareWalletError = (
  hwError: HardwareDeviceError,
  description: string,
  properties: {
    wallet: SupportedHardwareWallet
    step: 'connect' | 'scan' | 'account-select' | 'multisig-xpub-check' | 'sign-message'
    model?: string
  },
  additionalProperties: Record<string, unknown>,
): void => {
  browserLogger.error({ err: hwError, description, ...properties, ...additionalProperties }, description)
}
