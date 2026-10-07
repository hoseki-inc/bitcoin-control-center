import { VersionInfo } from '@start9labs/start-sdk'

export const v0_4_0_0 = VersionInfo.of({
  version: '0.4.0:0',
    releaseNotes: `Statements in USD, CAD, GBP, or EUR, a Bitcoin price chart, required mempool on StartOS, faster loading over Tor, more accurate statements and charts, and security fixes.

- Statements: choose USD, CAD, GBP, or EUR. The preview, PDF, and saved statement all use the selected currency and the same saved prices.
- Home: a Bitcoin price chart with 7-day, 30-day, 6-month, and 1-year ranges, using the same price sources as statements.
- StartOS: Electrs and mempool are now listed as required dependencies. Statements use mempool for prices and transaction details.
- StartOS: the app is served compressed, so it loads much faster, especially over Tor.
- Statements now cover self-custody accounts where you've proven ownership. For custodial accounts, your custodian can provide statements.
- Statements must end at least two days ago, so recent transactions have time to confirm.
- Statements retry when the transaction source is briefly unavailable or rate limited, and stop with an error instead of finishing incomplete if transaction details still can't be fetched.
- Fixed statements leaving out an account when two accounts had the same name.
- Fixed Strike and Robinhood history charts double counting imported transactions.
- Fixed Kraken occasionally rejecting balance and history requests.
- Ownership verification now checks that every signature comes from a key in the account being verified. Proofs signed with another account's key, or with unrelated or repeated multisig keys, are rejected.
- Opening a link with an invalid account or statement ID now shows an error instead of a blank page.
- Fixed oversized page titles on My Holdings.
- Coinbase: replaced a vulnerable signing library with Node's built-in cryptography.
- Updated dependencies with security fixes.

Existing accounts, settings, and statements carry over automatically. Earlier statements stay in USD.`,
  migrations: {},
})
