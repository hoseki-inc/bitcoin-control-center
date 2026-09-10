import { VersionInfo } from '@start9labs/start-sdk'

export const v0_2_4_0 = VersionInfo.of({
  version: '0.2.4:0',
  releaseNotes: `Security, privacy, and reliability improvements.

- Prevented sensitive wallet information in request inputs from appearing in automatic HTTP logs.
- Updated dependencies and patched known security advisories.
- Fixed Ledger multisig signing getting stuck with an "Unknown error."
- Improved final verification for Ledger and Trezor multisig accounts, including handling of slow responses and verification failures.
- Improved Ledger account discovery when reconnecting or switching devices, preventing stale results and unnecessary disconnect alerts.
- Fixed access through enabled StartOS public IP addresses and updated address handling to follow StartOS interface configuration.
- Updated the statement PDF renderer and expanded automated checks for consistent statement output.

No database migrations are required.`,
  migrations: {},
})
