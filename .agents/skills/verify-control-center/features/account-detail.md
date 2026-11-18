# Account detail

A user opens a wallet account from Accounts and reads its details: name, status, when it was first connected and added, its script type, the masked xpub, and its live on-chain balance in BTC and US dollars.

## Sub-features

Proves: `singlesig-detail`

Run `helpers/verify evidence begin account-detail` before driving it and `helpers/verify evidence record account-detail --status <status>` after.

## How to get to it (user POV)

- Accounts in the navigation, then an account's card.
- An account's name on Portfolio.
- `/accounts/<account id>` directly.

This recipe drives the first entry point. It changes no data.

## Driving it with the browser

Preconditions: the baseline seed. `Verify Savings` holds 0.74999 BTC.

- **Open Accounts**: click link `Accounts` in the navigation. The heading `Accounts` shows `1 Verified` and `2 Unverified`, and the cards `Verify Savings`, `Verify Watch Segwit` and `Verify Watch Taproot` are listed.
- **Open the account**: click the card `Verify Savings`. The URL becomes `/accounts/<id>`, where `<id>` starts with `re_`, and `Back to Accounts` and `Archive Account` show.
- **Read the details**: the page shows the name `Verify Savings`, `First Connected` with today's date, `Status` `Verified`, `Script Type` `Native SegWit (P2WPKH)`, `Date Added` with today's date, and the xpub masked as `xpub 6CFt **** … G1q8 P7A`.
- **Read the balance**: `Amount` shows `0.74999000 BTC` and a dollar value of about 0.74999 times the Home price, such as `$1,812.73` at a price of $2,417, the same as the Accounts card.
- **Stored proof**: `helpers/verify query --sql "SELECT a.id, a.display_name, a.status, (SELECT balance_sats FROM balance_snapshots b WHERE b.account_id = a.id ORDER BY b.timestamp DESC LIMIT 1) AS latest_sats FROM accounts a WHERE a.display_name = 'Verify Savings'"` into `stored.json`. The `id` matches the URL, `status` is `verified` and `latest_sats` is `74999000`.

## Gotchas

- `Amount` shows a loading state until the wallet scan answers. Wait for the BTC figure rather than a fixed delay.
- The dates are the browser's local day, so near midnight UTC they can differ from the stored `created_at`. Compare days in the browser's time zone.
- The watch-only accounts open the same page with `Status` `Unverified`; they are not this recipe's account.
