# Portfolio monthly change

Below the balance chart, a user sees how much they accumulated over the range, the average per month, an in and out bar when bitcoin left, and one bar per month. A range with no change says so. This recipe changes no data.

## Sub-features

Proves: `net-accumulated`, `in-out-bar`, `bar-chart`, `no-change`

## How to get to it (user POV)

- Portfolio, below the balance chart.

## Driving it with the browser

Preconditions: the baseline. The fake chain in `tools/verify/chain.ts` pays `Verify Watch Segwit` 1 BTC on 2025-12-15; `Verify Savings` 0.5 on 2026-01-10 and 0.25 on 2026-02-05, sends 0.10001 out (payment and fee) on 2026-03-01 and gets 0.1 on 2026-04-15; and pays `Verify Watch Taproot` 0.05 on 2026-02-20.

- **No change**: on `/portfolio` with the default `90D`, scroll to `NET ACCUMULATED`. It reads `0.00000000 BTC`, `Avg / month` `0.00000000` and `No net change in this date range.`
- **All time**: click `All` and wait. `NET ACCUMULATED` reads `+1.79999000 BTC`, `All time`, `Avg / month` `+0.14999917`, and the bar reads `+1.90000000 in` and `−0.10001000 out`.
- **Bars**: one bar per month from Dec 2025 to this month: up in Dec, Jan, Feb and Apr, down in Mar. Hover Mar: `Mar 2026`, `−0.10001000 BTC`. Hover Dec: `Dec 2025`, `+1.00000000 BTC`.
- **Stored proof**: `helpers/verify query --sql "SELECT a.display_name, (SELECT balance_sats FROM balance_snapshots b WHERE b.account_id = a.id ORDER BY b.timestamp DESC LIMIT 1) AS latest_sats FROM accounts a WHERE a.deleted_at IS NULL"` into `stored.json`.

## Gotchas

- The 0.39999 BTC change output on 2026-03-01 is internal: it counts in neither `in` nor `out`.
- Dollar values are at today's fake price, not the price on each date.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
