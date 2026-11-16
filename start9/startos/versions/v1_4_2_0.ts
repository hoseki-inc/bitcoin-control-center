import { VersionInfo } from '@start9labs/start-sdk'

export const v1_4_2_0 = VersionInfo.of({
  version: '1.4.2:0',
  releaseNotes: `Safer ETF holdings and small fixes.

- ETF accounts: share counts must be above zero, and purchase dates can't be in the future. The date picker stops at today, and the form won't save until both fields are valid.
- Layout: a few inputs and labels now use the same text spacing as the rest of the app.
- Updates to third-party dependencies.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
