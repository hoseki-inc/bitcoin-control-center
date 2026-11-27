# Accounts list

A user opens Accounts and sees their total in BTC and US dollars with how many accounts are Verified, Pending and Unverified, then one card per account with its status, name, balance, dollar value and share of the total. A card opens the account, and both Add Account entries open the chooser. This recipe changes no data.

## Sub-features

Proves: `header-totals`, `wallet-card`, `open-card`, `add-account-entry`

`sync-indicator` is claimed by `accounts-sync-electrum`, which takes the fake Electrum down.

## How to get to it (user POV)

- Accounts in the navigation.
- `/accounts` directly.

This recipe drives the first entry point.

## Driving it with the browser

Preconditions: the baseline.

- **Open Accounts**: click link `Accounts` in the navigation. The URL is `/accounts`.
- **Header totals**: the header reads `1.79999000 BTC`, `$4,350.58`, `1 Verified`, `2 Unverified` and `Synced`. The BTC is the sum of the three cards, and so is the dollar figure.
- **Cards**: three cards, each a link to `/accounts/<id>`: `Unverified` `Verify Watch Taproot` `0.05000000 BTC` `$120.85` `2.8%`; `Unverified` `Verify Watch Segwit` `1.00000000 BTC` `$2,417.00` `55.6%`; `Verified` `Verify Savings` `0.74999000 BTC` `$1,812.73` `41.7%`.
- **Header entry**: click link `Add Account`. The URL becomes `/accounts/add` with the heading `Connect New Account`. Go back.
- **Dashed card**: click button `+ Add account` after the last card. The same chooser opens. Go back.
- **Open a card**: click `Verify Watch Segwit`. The URL becomes `/accounts/<id>` with the heading `Verify Watch Segwit`, `1.00000000 BTC` and `Unverified`.
- **Stored proof**: `helpers/verify query --sql "SELECT a.display_name, a.status, (SELECT balance_sats FROM balance_snapshots b WHERE b.account_id = a.id ORDER BY b.timestamp DESC LIMIT 1) AS latest_sats FROM accounts a WHERE a.deleted_at IS NULL ORDER BY a.created_at"` into `stored.json`. The statuses and balances match the cards.

## Gotchas

- Dollar values depend on the fake price, $2,417 on 2026-11-18. On another day, check that each card's dollars are its BTC times the Home price.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
