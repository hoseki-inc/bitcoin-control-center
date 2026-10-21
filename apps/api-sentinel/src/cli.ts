import { inspect } from 'node:util'
import { hideWalletDetailsInError, hideWalletDetailsInText, hidesWalletDetails } from './log_redaction'
import { main } from './main'

// `pnpm dev:desktop` runs Sentinel as the desktop app does: with saved connections,
// and with settings available even while the Electrum server is unreachable.
const desktop = process.argv.includes('--desktop')

// A crash prints to stderr, bypassing the logger, so it hides wallet details and hosts the same
// way. At Debug and Trace, Node prints crashes in full as before.
const hideDetails = hidesWalletDetails(process.env['LOG_LEVEL'] ?? 'info')
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

main(desktop ? { connectionProfiles: true, waitForElectrum: false, statementSourceSetting: true } : {}).catch(
  crashed('Unhandled error in main:'),
)
