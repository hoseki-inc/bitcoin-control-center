import { VersionInfo } from '@start9labs/start-sdk'

export const v1_4_3_0 = VersionInfo.of({
  version: '1.4.3:0',
  releaseNotes: `Newer Coinbase keys, safer account changes, and steadier refreshes.

- Exchanges: Coinbase's current API keys now connect, even when pasted with stray quotes or line breaks. If a key stops working, Control Center asks you to reconnect, and one slow exchange no longer holds up every other balance.
- Adding wallets: when you paste a plain xpub, you now pick its address type instead of getting Legacy by default, and Control Center shows the balance for each type before you save.
- Accounts: removing an exchange or ETF account now asks you to confirm first. Manual transactions can no longer leave a balance wrong or below zero.
- Portfolio: account history loads faster, charts stay on screen when you switch accounts, and pages recover on their own after a connection problem.
- Privacy and fixes: wallet and Bitcoin images now ship with the app instead of loading from Hoseki's servers. Also small fixes to dollar rounding, account names, error messages and screen reader labels, plus updates to third-party dependencies.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
