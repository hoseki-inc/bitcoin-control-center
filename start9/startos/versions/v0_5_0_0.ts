import { VersionInfo } from '@start9labs/start-sdk'

export const v0_5_0_0 = VersionInfo.of({
  version: '0.5.0:0',
  releaseNotes: `Redesigned Home, Statements, and Portfolio, balances that hold up when Electrum is unreachable, and a more reliable database.

- Home: leads with your Bitcoin balance, a 30-day balance chart with the 30-day change, and how many accounts you track. The Bitcoin price chart and your recent statements follow.
- Statements: a refreshed statements table and statement cards, statement details that fit smaller screens, and a cleaner account picker when creating a statement.
- Portfolio: a redesigned account sidebar with compact and detailed views, search, exchange logos and wallet avatars, each account's share of your portfolio, and badges for pending and manually added accounts.
- Portfolio: a larger balance at the top, with the change for the selected range shown in the chart card. Clear an account filter with one click.
- Portfolio: a new Net accumulated card shows your net change for the range, your average per month, approximate money in and out, and a bar for every month.
- Portfolio: each account shows its history sync progress, and the previous chart stays in place while a new selection loads.
- When your Electrum server is unreachable, wallets show their last known balance instead of 0 BTC, the header shows when balances last synced, and balances recover on their own once the server is back.
- Fixed the empty Portfolio page ignoring the page margins.
- Accessibility: screen readers announce each account's balance and status, charts can be reached with the keyboard, and reduced motion is respected.
- A rebuilt database layer makes saving balances, history imports, and statement numbers more reliable.
- If you started verifying a wallet's ownership but didn't finish, you'll need to sign again. Completed verifications aren't affected.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
