import { VersionInfo } from '@start9labs/start-sdk'

export const v0_2_3_0 = VersionInfo.of({
  version: '0.2.3:0',
  releaseNotes: `Custom date ranges and more reliable portfolio history.

- Choose start and end dates, then press Apply to load.
- All now starts at your earliest portfolio activity, including archived wallets.
- Fetch missing self-custody history and reuse it for future selections.
- Improved timezone handling, loading, retries, and offline recovery.
- Updated a vulnerable dependency and improved StartOS build tooling.

Older history may take longer to load the first time. No database migrations required.`,
  migrations: {},
})
