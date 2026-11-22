# Accounts with no price

On a run that has never had a price, Accounts shows balances in BTC only, never `$0.00`. This recipe tracks one wallet, or reuses the one `home-no-price` tracked.

## Sub-features

Proves: `usd-hidden-without-price`

## How to get to it (user POV)

- Accounts, when no price source has ever answered.

## Driving it with the browser

Preconditions: a run launched with `--fresh`, not seeded, with `helpers/verify fault mempool down` run before the app is opened. Onboarding closed with `Skip`. Track `Verify No Price` as `home-no-price` does, unless it is already there.

- **No dollars**: open Accounts. Grey placeholders stand where dollar values go while Sentinel looks for a price, for up to 15 seconds; then they go. The header reads `0.10000000 BTC`, `1 Unverified` and `Synced` with no dollar figure, and the card reads `Unverified`, `Verify No Price`, `0.10000000 BTC` and `100.0%` with no dollar figure.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS quotes FROM btc_quote_cache"` into `stored.json`: 0.
- **Back**: `helpers/verify fault mempool ok`.

## Gotchas

- Open the app only after the fault is on: one price fetch gives Sentinel a last known price for about an hour.
- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
