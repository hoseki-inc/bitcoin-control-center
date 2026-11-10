import { VersionInfo } from '@start9labs/start-sdk'

export const v1_4_1_0 = VersionInfo.of({
  version: '1.4.1:0',
  releaseNotes: `Clearer errors and security updates.

- Adding accounts: if you paste a private key, Control Center now says so and asks for the public key (xpub) or a watch-only descriptor instead.
- Help: the multisig export guide now opens the Control Center help page.
- Security updates to third-party dependencies.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
