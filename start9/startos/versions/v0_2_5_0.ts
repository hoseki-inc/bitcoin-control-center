import { VersionInfo } from '@start9labs/start-sdk'

export const v0_2_5_0 = VersionInfo.of({
  version: '0.2.5:0',
  releaseNotes: `Security hardening, dependency updates, and reliability improvements.

- Updated application dependencies, Ledger support libraries, Bitcoin message-signing tools, and the Electron desktop runtime.
- Strengthened validation of stored exchange credentials and ETF ticker data.
- Improved multisig verification recovery so saved signatures can finish verification without signing again, and blocked duplicate Coldcard submissions.
- Improved Ledger cancellation and recovery from unresponsive device connections.
- Improved desktop startup errors and shutdown handling.
- Improved settings loading, saving, and connection error handling.
- Added automated security scanning, stricter code checks, and production package build checks for StartOS, macOS, and Windows.

No database migrations are required.`,
  migrations: {},
})
