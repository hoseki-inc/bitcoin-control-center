import { inspect } from 'node:util'
import { hideWalletDetailsInError, hideWalletDetailsInText, hidesWalletDetails } from './log_redaction'

/**
 * A crash prints to stderr, bypassing the logger, so it hides wallet details and hosts the same
 * way. At Debug and Trace, Node prints crashes in full as before. Returns the handler for a
 * rejection from `main`.
 */
export function reportCrashes(logLevel: string): (cause: unknown) => void {
  const hideDetails = hidesWalletDetails(logLevel)
  const crashed =
    (label: string) =>
    (cause: unknown): void => {
      const shown = !hideDetails
        ? cause
        : cause instanceof Error
          ? hideWalletDetailsInError(cause)
          : hideWalletDetailsInText(inspect(cause))
      console.error(label, shown)
      process.exit(1)
    }

  if (hideDetails) {
    process.on('uncaughtException', crashed('Uncaught exception:'))
    process.on('unhandledRejection', crashed('Unhandled rejection:'))
  }
  return crashed('Unhandled error in main:')
}
