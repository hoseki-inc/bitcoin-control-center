import { hideWalletDetailsInText, hidesWalletDetails } from './log_redaction'
import { main } from './main'

// `pnpm dev:desktop` runs Sentinel as the desktop app does: with saved connections,
// and with settings available even while the Electrum server is unreachable.
const desktop = process.argv.includes('--desktop')

main(desktop ? { connectionProfiles: true, waitForElectrum: false, statementSourceSetting: true } : {}).catch(
  (cause: unknown) => {
    // This bypasses the logger, so it hides wallet details and hosts the same way.
    const shown = hidesWalletDetails(process.env['LOG_LEVEL'] ?? 'info')
      ? hideWalletDetailsInText(cause instanceof Error ? (cause.stack ?? String(cause)) : String(cause))
      : cause
    console.error('Unhandled error in main:', shown)
    process.exit(1)
  },
)
