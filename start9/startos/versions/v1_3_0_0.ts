import { VersionInfo } from '@start9labs/start-sdk'

export const v1_3_0_0 = VersionInfo.of({
  version: '1.3.0:0',
  releaseNotes: `Bitkey support and track-only wallets.

- Bitkey: connect your Bitkey by pasting its wallet descriptor from the Bitkey app. Its balance and history show in Control Center. Bitkey doesn't support proving ownership of its keys, so it stays Unverified and isn't included in statements.
- Track a wallet: add an xpub or a wallet descriptor to watch its balance without proving you own it. Prove ownership later by adding the same wallet again with your device.
- Add Account: simpler options, with Manually Sign and Track Balance, ETF, or xpub.
- Manual accounts: the Portfolio chart now starts a manual account's balance on the date you chose, and removing one asks you to confirm first.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
