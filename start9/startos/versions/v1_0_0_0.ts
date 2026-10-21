import { VersionInfo } from '@start9labs/start-sdk'

export const v1_0_0_0 = VersionInfo.of({
  version: '1.0.0:0',
  releaseNotes: `Welcome to Bitcoin Control Center 1.0.

Are you stacking enough? Control Center brings all your Bitcoin into one private place, read from your own node. It's built to help you understand, grow, protect, and eventually use your Bitcoin savings.

- Track your stack: Ledger, Trezor, Coldcard, Keystone, any wallet or multisig, Coinbase, Kraken, Robinhood, Strike, and ETFs.
- Bank statements for self-custody, with Hoseki's proof of reserves behind each one.
- Your node, your data: watch-only, stored on your machine, no account and no cloud.

Runs on StartOS, Umbrel, macOS and Windows. Thanks to everyone who tested the 0.x releases.`,
  migrations: {},
})
