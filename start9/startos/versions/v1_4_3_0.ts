import { VersionInfo } from '@start9labs/start-sdk'

export const v1_4_3_0 = VersionInfo.of({
  version: '1.4.3:0',
  releaseNotes: `Clearer errors and safer account updates.

- Exchanges: Control Center now tells you when an exchange key stops working and asks you to reconnect.
- Manual accounts: deleting or adding transactions can no longer leave a balance wrong or below zero.
- Errors: pages recover on their own after a connection problem, and error messages say what went wrong.
- Small fixes to dollar rounding, account names and screen reader labels.
- Updates to third-party dependencies.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
