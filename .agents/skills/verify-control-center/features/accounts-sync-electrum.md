# Accounts while Electrum is down

When Electrum stops answering, Accounts keeps every balance and says how old it is, then says `Synced` again once Electrum is back. This recipe changes no data.

## Sub-features

Proves: `sync-indicator`

`Can't reach Electrum`, for a wallet that has never synced, shows in `accounts-archive-offline`.

## How to get to it (user POV)

- Accounts in the navigation, while the Electrum server is down.

## Driving it with the browser

Preconditions: the baseline, with no fault on.

- **Synced**: on `/accounts`, the header reads `1.79999000 BTC`, `1 Verified`, `2 Unverified` and `Synced`.
- **Down**: `helpers/verify fault electrum down`. Sentinel reuses balances for a minute, so the header still reads `Synced` until then.
- **Last synced**: a minute or more after the last scan, reload `/accounts`. The header reads `Last synced 1 minute ago` (or more minutes) with the scan's date and time below it, and every card keeps its balance: `0.05000000 BTC`, `1.00000000 BTC` and `0.74999000 BTC`.
- **Stored proof**: `helpers/verify query --sql "SELECT account_id, MAX(timestamp) AS last_snapshot FROM balance_snapshots GROUP BY account_id"` into `stored.json`: no snapshot is newer than the outage.
- **Back**: `helpers/verify fault electrum ok`. Within a minute, without a reload, the header reads `Synced` again with the same balances.

## Gotchas

- Sentinel waits up to a minute between retries of a failing wallet, so `Synced` can take that long to return.
- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
