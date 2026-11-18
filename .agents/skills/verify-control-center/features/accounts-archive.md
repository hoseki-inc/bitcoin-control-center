# Archive, restore and delete an account

A user archives a wallet account. The dialog warns when the wallet still holds bitcoin, and the account leaves the list and the totals but stays under Archived. From there it can be restored or deleted permanently. Adding an archived wallet again sends the user to Archived instead of making a second account. This recipe tracks its own wallet and deletes it at the end, so the run ends as it started.

## Sub-features

Proves: `archive`, `balance-warning`, `archived-section`, `restore`, `delete-permanently`, `re-add-archived`

## How to get to it (user POV)

- Accounts, an account's card, then `Archive Account`.
- `Archived (N)` below the account cards, or `/accounts#archived`, for restore and delete.

This recipe drives both.

## Driving it with the browser

Preconditions: the baseline. The key is a public test key from `packages/testing/wallets.ts`; the seeded chain pays it 0.1 BTC.

- **Track a wallet**: open `/accounts/verify/track`, type `Verify Archive Me` and `xpub6CQrPd5mpXz9HHdoKXJDjoGUhjBpfhvT63HEVKHr8C2cSeyX7wiKmLJCew6kDRg9rt8Pe7jAP5x3h9MW8cGCxYdEgEWQegv9knmqGSaeCoP`, pick `Nested SegWit (P2SH)` and click `Track Wallet`. The account page shows `0.10000000 BTC`.
- **Balance warning**: click `Archive Account`. The dialog `Archive Account?` says `This wallet still holds 0.10000000 BTC.` and that archiving stops live balance tracking, then that Archive stops tracking `Verify Archive Me` but keeps its history. Button `Archive` is enabled once the balance check finishes.
- **Archive**: click the dialog's `Archive`. The URL becomes `/accounts`, toast `'Verify Archive Me' archived`, the totals are back to `1.79999000 BTC`, and `Archived (1)` shows below the cards.
- **Archived section**: click `Archived (1)`. It lists `Verify Archive Me` with `Delete Permanently` and `Restore`.
- **Restore**: click `Restore`. Toast `Account restored`; the card is back, the header reads `1.89999000 BTC` and `3 Unverified`, and the Archived section is gone.
- **Archive again**: open the card and archive it again the same way.
- **Re-add the archived wallet**: open `/accounts/verify/advanced` (Manually Sign), type `Verify Archive Again` and the same key, pick `Nested SegWit (P2SH)` and click `Add Account`. Toast `This account is archived` with `Restore it from Archived accounts before reconnecting.`; the URL becomes `/accounts#archived` with the Archived section open.
- **Stored proof, after re-adding**: `helpers/verify query --sql "SELECT display_name, deleted_at IS NOT NULL AS archived FROM accounts ORDER BY created_at"` into `stored.json`: the three seeded accounts, then one `Verify Archive Me` with `archived` 1, and no `Verify Archive Again`.
- **Delete permanently**: click `Delete Permanently` on the archived row. The dialog `Delete Account Permanently?` says it removes `Verify Archive Me` and all its balance history and cannot be undone. Click the dialog's `Delete Permanently`. Toast `'Verify Archive Me' account deleted`; the URL is `/accounts`, the totals are the baseline and the Archived section is gone.
- **Stored proof, after deleting**: run the same query and `helpers/verify query --sql "SELECT count(*) AS snapshots FROM balance_snapshots WHERE account_id = '<id>'"`, and add both to `stored.json` under their own keys: only the three seeded accounts, and 0 snapshots.

## Gotchas

- Archiving marks the account with `deleted_at`; it is not gone until Delete Permanently.
- The Archived section only shows when something is archived, below the cards; scroll to it.
- This recipe re-adds through Manually Sign only. It doesn't check what the Track form does with an archived wallet.
- A click can miss when the layout has just shifted, for example when the script type radios appear, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
