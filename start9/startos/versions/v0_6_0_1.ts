import { VersionInfo } from '@start9labs/start-sdk'

export const v0_6_0_0 = VersionInfo.of({
  version: '0.6.0:1',
  releaseNotes: `Statement, privacy, and reliability improvements.

- Statements: faster and more reliable generation, with progress shown while they build. Statements can now be deleted.
- Privacy: statements no longer reveal which days you had transactions, and desktop can look up statement transactions on your own Electrum server.
- Security: Control Center refuses changes from other web pages on your computer.
- Desktop: a notice tells you when a new version is available.
- A new Bitcoin Control Center icon.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
