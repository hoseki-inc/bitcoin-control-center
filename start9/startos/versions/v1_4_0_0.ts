import { VersionInfo } from '@start9labs/start-sdk'

export const v1_4_0_0 = VersionInfo.of({
  version: '1.4.0:0',
  releaseNotes: `A redesigned PIN and new success screens.

- PIN: the lock, setup and Forgot PIN screens now match the introduction, and unlocking is faster. Resetting your PIN keeps your accounts and history as they are.
- Adding accounts: every connection now ends on a success screen showing the device or app, its balance and whether it's verified.
- Desktop: before you add your first account, choose Blockstream's public server, with the option to connect through Tor, or your own Electrum server.
- Statements: where the app explains them, they're now called proof-of-ownership statements.
- Safety: Control Center only watches your wallets, so it now refuses wallets that include a private key. If an earlier import saved one, it's replaced with the matching public key when you update.
- Updates to third-party dependencies.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
