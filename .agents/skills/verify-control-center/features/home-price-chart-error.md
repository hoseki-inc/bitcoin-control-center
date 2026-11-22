# Price chart with no price

When no price source answers, Home's Bitcoin Price card shows a dash, says why, and offers Retry. This recipe changes no data.

## Sub-features

Proves: `price-error`

## How to get to it (user POV)

- Home, when the price source is down.

## Driving it with the browser

Preconditions: a run launched with `--fresh`, not seeded, with `helpers/verify fault mempool down` run before the app is opened, and onboarding closed with `Skip`.

- **Error**: open `/home`. `Bitcoin Price` reads `—`, the chart reads `Price history for this range is not available from your allowed price sources.` and `Price sources and fallbacks are set in Settings.`, and a `Retry` button shows.
- **Retry, still down**: click `Retry`. The same message comes back.
- **Back**: `helpers/verify fault mempool ok`, wait 30 seconds, then click `Retry`. The price, the chart and `Source: Your mempool server` show.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS quotes FROM btc_quote_cache"` into `stored.json` after the retry: more than 0.

## Gotchas

- Sentinel holds a failed price source in a 30-second cooldown, so a Retry right after the fault is put right still shows the error.
- The summary above keeps `USD value unavailable` until the page reloads.
- Open the app only after the fault is on: one price fetch gives Sentinel a last known price for about an hour.
- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
