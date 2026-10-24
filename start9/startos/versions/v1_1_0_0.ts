import { VersionInfo } from '@start9labs/start-sdk'

export const v1_1_0_0 = VersionInfo.of({
  version: '1.1.0:0',
  releaseNotes: `Account PINs and Trezor update.

- Account PINs: protect Control Center with a 6-digit PIN on StartOS, Umbrel, and desktop. Lock it anytime, change your PIN in Settings, or sign out everywhere.
- Trezor: works again with current Trezor Suite and the Trezor Safe 7.
- Portfolio: a simpler account list.
- Security updates to third-party dependencies.

After updating, you'll be asked to set a PIN. On StartOS, use the Set PIN action. Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
