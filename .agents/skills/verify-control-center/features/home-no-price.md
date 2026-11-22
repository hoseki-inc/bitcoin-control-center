# Home with no price

On a run that has never had a price, Home shows the total in BTC and says the US dollar value is unavailable. This recipe tracks one wallet.

## Sub-features

Proves: `usd-unavailable`

## How to get to it (user POV)

- Home, when no price source has ever answered.

## Driving it with the browser

Preconditions: a run launched with `--fresh`, not seeded, with `helpers/verify fault mempool down` run before the app is opened, and onboarding closed with `Skip`. The key below is a public test key from `packages/testing/wallets.ts`.

- **Track a wallet**: open `/accounts/verify/track`, type `Verify No Price` and `xpub6CQrPd5mpXz9HHdoKXJDjoGUhjBpfhvT63HEVKHr8C2cSeyX7wiKmLJCew6kDRg9rt8Pe7jAP5x3h9MW8cGCxYdEgEWQegv9knmqGSaeCoP`, pick `Nested SegWit (P2SH)` and click `Track Wallet`. The account page shows `0.10000000 BTC`.
- **No price**: open Home. The summary reads `0.10000000 BTC` and `USD value unavailable`, with no dollar figure anywhere in it.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS quotes FROM btc_quote_cache"` into `stored.json`: 0, so Sentinel has no price at all.
- **Back**: `helpers/verify fault mempool ok`.

## Gotchas

- `30d Change` reads `+0.10000000 BTC` here, though the wallet's only payment is from 2026-03-01. That is a separate finding, not this recipe's claim.
- Open the app only after the fault is on: one price fetch gives Sentinel a last known price for about an hour.
- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A click or typing can miss while a page fades in after loading. Check the result after every action, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
