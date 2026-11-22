# Home while Electrum is down

When Electrum stops answering, Home keeps the total and says how old it is, then drops the notice once Electrum is back. This recipe changes no data.

## Sub-features

Proves: `sync-indicator`

## How to get to it (user POV)

- Home, while the Electrum server is down.

## Driving it with the browser

Preconditions: the baseline, with no fault on.

- **Current**: on `/home`, the summary reads `1.79999000 BTC` with no sync notice.
- **Down**: `helpers/verify fault electrum down`. Sentinel reuses balances for a minute, so nothing changes until then.
- **Last synced**: a minute or more after the last scan, reload `/home`. Under `Last 30 Days` the summary reads `Last synced 1 minute ago` (or more minutes) with the scan's date and time, and still `1.79999000 BTC`.
- **Stored proof**: `helpers/verify query --sql "SELECT account_id, MAX(timestamp) AS last_snapshot FROM balance_snapshots GROUP BY account_id"` into `stored.json`: no snapshot is newer than the outage.
- **Back**: `helpers/verify fault electrum ok`. Once Accounts reads `Synced` again, open Home from the navigation: the notice is gone.

## Gotchas

- Sentinel waits up to a minute between retries of a failing wallet, so the notice can take that long to clear.
- Home's 30-day change can count the whole balance as new while Electrum is down before the wallets' history has loaded. That is a separate finding, not this recipe's claim.
- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
