import { VersionInfo } from '@start9labs/start-sdk'

export const v0_2_6_0 = VersionInfo.of({
  version: '0.2.6:0',
  releaseNotes: `Accessibility improvements, stronger data validation, and maintenance updates.

- Improved keyboard navigation and screen-reader support for account selection, statement cards, wallet selection, and file uploads.
- Improved wallet-file imports with explicit text and image handling and stronger content validation.
- Added stricter validation of Bitcoin price and transaction data, preventing malformed transaction responses from producing incomplete statements.
- Improved handling of invalid saved exchange credentials, statement data, and local UI preferences.
- Expanded automated tests and completed stricter code-quality checks across the application, desktop runtime, and StartOS packaging.`,
  migrations: {},
})
