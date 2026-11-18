# Portfolio history

A user reads their balance over time on Portfolio: the current total, a balance chart for 7D, 30D, 90D, 1Y, All or a custom range, and the signed change over that range with a percentage. Generate Statement opens the statement form with the shown accounts ticked. This recipe changes no data.

## Sub-features

Proves: `balance`, `range-presets`, `period-change`, `custom-range`, `custom-validation`, `generate-statement`

`no-history-range` is not claimed: a range before any history draws a flat zero line. `No history for this range` only shows when the chart has no points at all.

## How to get to it (user POV)

- Portfolio in the navigation, or View Portfolio on Home.

## Driving it with the browser

Preconditions: the baseline. The fake chain in `tools/verify/chain.ts` pays `Verify Watch Segwit` 1 BTC on 2025-12-15; `Verify Savings` 0.5 on 2026-01-10 and 0.25 on 2026-02-05, sends 0.10001 out (payment and fee) on 2026-03-01 and gets 0.1 on 2026-04-15; and pays `Verify Watch Taproot` 0.05 on 2026-02-20.

- **Open Portfolio**: go to `/portfolio`. The header reads `All accounts`, `1.79999000 BTC` and `$4,350.58`. `90D` is pressed; the change is `0.00000000 BTC` with `Last 90 days`.
- **Presets**: click `All`. After `Preparing history for this date range`, the change reads `+1.79999000 BTC` with `All time`. `1Y` reads `+1.79999000` with `Last year`; `30D` and `7D` read `0.00000000` with `Last 30 days` and `Last 7 days`. Only the clicked button has `aria-pressed="true"`.
- **Custom, invalid**: click `Custom`. In the dialog `Choose a date range`, each of these shows its message and disables `Apply`: an empty `Start date` (`Choose both a start date and an end date.`); start `2026-05-01`, end `2026-04-01` (`Start date must be on or before end date.`); end `2027-01-01` (`End date cannot be in the future.`); start `2008-12-01` (`Start date cannot be before Bitcoin genesis.`).
- **Custom, valid**: set `2026-01-01` to `2026-03-31` and click `Apply`. The change reads `+0.69999000 BTC` and `+70.0%`, with `Jan 1, 2026 – Mar 31, 2026`.
- **Generate Statement**: click `Generate Statement`. The URL becomes `/statements/create` with `Verify Savings`, the only verified account, ticked.
- **Stored proof**: `helpers/verify query --sql "SELECT a.display_name, a.status, (SELECT balance_sats FROM balance_snapshots b WHERE b.account_id = a.id ORDER BY b.timestamp DESC LIMIT 1) AS latest_sats FROM accounts a WHERE a.deleted_at IS NULL ORDER BY a.created_at"` into `stored.json`.

## Gotchas

- Longer ranges show `Preparing history for this date range` for several seconds. Wait for the change to show.
- The statement form uses its own default dates, not the portfolio's range.
- Use form_input for the date fields.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
