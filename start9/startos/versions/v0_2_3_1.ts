import { VersionInfo } from '@start9labs/start-sdk'

export const v0_2_3_1 = VersionInfo.of({
  version: '0.2.3:1',
  releaseNotes: `Portfolio reliability and performance improvements.

- Portfolio now defaults to a 90-day view.
- Fixed loading-screen flashes when selecting wallets or clearing selections.
- Improved history loading and error messages, keeping completed charts visible during background updates.
- Reduced repeated Electrum requests and sped up history processing.
- Added regression tests for date ranges, account selection, and history syncing.

No database migrations are required.`,
  migrations: {},
})
