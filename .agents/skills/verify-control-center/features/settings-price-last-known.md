# Last known price

When the only price source stops answering, Control Center keeps the last price it had and Settings says so. This recipe changes no data.

## Sub-features

Proves: `last-known`

`fallback-in-use` is not claimed: fallbacks reach public price services, which a verify run never calls.

## How to get to it (user POV)

- Settings, `Bitcoin price`, while the price source is down.

## Driving it with the browser

Preconditions: a seeded run with no fault on, so Sentinel has a price.

- **Down**: `helpers/verify fault mempool down`. Sentinel reuses a price for a minute, so wait at least that long.
- **Notice**: reload `/settings`. Under `Allow fallbacks` it reads `No price source is available right now. Showing the last known price.` Home's `Bitcoin Price` still shows a dollar price.
- **Stored proof**: `helpers/verify query --sql "SELECT key, value FROM settings WHERE key LIKE 'price%'"` into `stored.json`: the source is still `mempool` with fallbacks off.
- **Back**: `helpers/verify fault mempool ok`, then reload `/settings`. The notice is gone.

## Gotchas

- A last known price lasts about an hour for a self-hosted mempool. The no-price states need a run that never had one: see `home-no-price`.
- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
