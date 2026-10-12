import { main } from './main'

// `pnpm dev:desktop` runs Sentinel as the desktop app does: with saved connections,
// and with settings available even while the Electrum server is unreachable.
const desktop = process.argv.includes('--desktop')

main(desktop ? { connectionProfiles: true, waitForElectrum: false, statementSourceSetting: true } : {}).catch(
  (cause: unknown) => {
    console.error('Unhandled error in main:', cause)
    process.exit(1)
  },
)
