# Portfolio account filter

A user narrows Portfolio to some accounts from the sidebar. The label, balance and charts follow the selection, Clear returns to all accounts, search narrows the list, and Manage accounts opens Accounts. This recipe changes no data.

## Sub-features

Proves: `all-accounts`, `toggle-account`, `search`, `clear`, `manage`

`badges` is not claimed: the seed has no pending account. `narrow-dropdown` needs a narrow window.

## How to get to it (user POV)

- Portfolio, the Accounts sidebar.

## Driving it with the browser

Preconditions: the baseline.

- **All accounts**: on `/portfolio`, the sidebar reads `Accounts` `3 of 3` with toggle buttons `All accounts 1.79999000 BTC` (pressed), `Verify Watch Segwit`, `Verify Savings` and `Verify Watch Taproot`, each with BTC and its share, and `Unverified` on the two watch-only accounts.
- **One account**: click `Verify Savings`. It is pressed, the sidebar reads `1 of 3` with `Clear`, and the header reads `Verify Savings`, `0.74999000 BTC`, `$1,812.73`.
- **Two accounts**: click `Verify Watch Taproot`. The sidebar reads `2 of 3`; the header reads `2 accounts`, `0.79999000 BTC`, `$1,933.58`.
- **Clear**: click `Clear account filter`. `All accounts` is pressed, `3 of 3`, `1.79999000 BTC`.
- **Search**: click button `Search accounts` and type `taproot`. Only `Verify Watch Taproot` is listed under `All accounts`. Replace it with `zzz`: `No accounts match your search.`
- **Manage**: click link `Manage accounts`. The URL becomes `/accounts`.
- **Stored proof**: `helpers/verify query --sql "SELECT a.display_name, (SELECT balance_sats FROM balance_snapshots b WHERE b.account_id = a.id ORDER BY b.timestamp DESC LIMIT 1) AS latest_sats FROM accounts a WHERE a.deleted_at IS NULL"` into `stored.json`: 74999000 and 5000000 sats add up to the two-account header.

## Gotchas

- Some browser tools' trees list the account rows as unnamed buttons. Find them by their text, and check `aria-pressed`.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
