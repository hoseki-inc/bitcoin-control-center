# Home summary

A user opens Home and sees their total in BTC and US dollars, a chart of the last 30 days with a tooltip, the 30-day change, how many accounts they track, and View Portfolio. This recipe changes no data.

## Sub-features

Proves: `total`, `open-portfolio`, `chart-30d`, `change-30d`, `account-count`

## How to get to it (user POV)

- Home in the navigation, the logo, or `/`.

## Driving it with the browser

Preconditions: the baseline. Every seeded transaction is older than 30 days.

- **Open Home**: go to `/home` and wait for the fade-in. The total reads `1.79999000 BTC` and `$4,350.58` (at the fake price of $2,417 on 2026-11-18).
- **Chart**: `Last 30 Days` shows a flat line from 30 days ago to today. Hover the line. A tooltip shows a date and `1.79999000 BTC`.
- **Change**: `30d Change` reads `+0.00000000 BTC` and `$0.00`.
- **Count**: `Accounts` reads `3 tracked`.
- **Portfolio**: click link `View Portfolio`. The URL becomes `/portfolio`.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS tracked, sum((SELECT balance_sats FROM balance_snapshots b WHERE b.account_id = a.id ORDER BY b.timestamp DESC LIMIT 1)) AS total_sats FROM accounts a WHERE a.deleted_at IS NULL"` into `stored.json`: 3 and `179999000`.

## Gotchas

- Read the values after the page settles. On a run's very first Home load, `30d Change` briefly read `+1.79999000 BTC` before the history loaded.
- Dollar values follow the fake price, which rises $1 a day.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
