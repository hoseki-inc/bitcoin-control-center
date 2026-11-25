# Archive while Electrum is down

A wallet added while Electrum is down has no known balance. Accounts says `Can't reach Electrum`, and the archive dialog refuses to archive until the balance can be checked. Once Electrum is back, the wallet syncs and archives normally. This recipe tracks its own wallet and deletes it at the end, so the run ends as it started.

## Sub-features

Proves: `balance-unknown`

## How to get to it (user POV)

- An account's page, then `Archive Account`, while the Electrum server is down.

## Driving it with the browser

Preconditions: the baseline, with no fault on. The key below is a public test key from `packages/testing/wallets.ts`, with no balance on the seeded chain.

- **Down**: `helpers/verify fault electrum down`.
- **Track a wallet**: open `/accounts/verify/track`, type `Verify Archive Offline` and `xpub6BqN8FZQhMmbuUehywWNTkRjMAYpTNhqvu6fMiYx4dw9Bagf8218mXwD8QGMswfcAAiqxfUoiHiGcV1iE3oDG9rFBoyDBw1a6FJAFVQhc1j`, pick `Legacy (P2PKH)` and click `Track Wallet`. The account page shows Amount `n/a`.
- **Can't reach Electrum**: Accounts' header reads `Can't reach Electrum`.
- **Refused**: back on the account's page, click `Archive Account`. The dialog `Archive Account?` reads `We could not determine this account's current balance. Archive is disabled; refresh and try again.`, and its `Archive` button is disabled. Click `Cancel`.
- **Stored proof, while down**: `helpers/verify query --sql "SELECT a.display_name, a.deleted_at, (SELECT count(*) FROM balance_snapshots b WHERE b.account_id = a.id) AS snapshots FROM accounts a WHERE a.display_name = 'Verify Archive Offline'"` into `stored.json`: not archived, no snapshots.
- **Back**: `helpers/verify fault electrum ok`. The account page doesn't refresh by itself: wait a minute, then reload it. It shows `0.00000000 BTC`.
- **Archive and delete**: click `Archive Account`. `Archive` is enabled once the balance check finishes; click it. On `/accounts`, open `Archived (1)`, click `Delete Permanently`, then the dialog's `Delete Permanently`. The totals are the baseline and the Archived section is gone.

## Gotchas

- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A click or typing can miss while a page fades in after loading. Check the result after every action, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
