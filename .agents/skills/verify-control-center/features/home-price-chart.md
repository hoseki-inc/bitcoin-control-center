# Home price chart

A user reads the Bitcoin price on Home: the latest price, its change over the chosen range, a line chart of that range, and the source the price came from. 7D is the default; 30D, 6M and 1Y switch the chart and the change.

## Sub-features

Proves: `price-heading`, `range-switch`, `source-footer`

Run `helpers/verify evidence begin home-price-chart` before driving it and `helpers/verify evidence record home-price-chart --status <status>` after.

## How to get to it (user POV)

- Home in the navigation.
- `/home` directly.

This recipe drives the first entry point. It changes no data.

## Driving it with the browser

Preconditions: a launched run with prices from the fake mempool (the doctor's `prices` check passes). Seeding doesn't matter.

- **Open Home**: click link `Home` in the navigation. The URL is `/home`.
- **Read the price**: the heading `Bitcoin Price` shows a dollar price and a change marked `· 7d`, such as `$2,417` and `+0.29% · 7d`. Fake prices are $1,000 on January 1, 2023 plus $1 a day, so the price is today's day count since then plus 1,000, and the 7-day change is positive.
- **Default range**: in the group `Bitcoin price time range`, button `7D` is pressed (`aria-pressed="true"`) and the chart's dates span the last week.
- **Switch the range**: click button `30D`. It becomes the pressed button, the change now ends in `· 30d` and is larger than the 7-day change, and the chart's dates span about a month. Repeat with `6M` and `1Y`; each changes the suffix and the date span.
- **Source**: below the chart, the footer reads `Source: Your mempool server`.
- **Stored proof**: none, since nothing is stored. The second view is Settings: `Bitcoin price` shows Price source `Your mempool server` with this run's mempool port.

## Gotchas

- A price far above a few thousand dollars means the app reached a real price service. Stop and check the doctor's `prices` check.
- A screenshot right after a click can still highlight the previous range. Read `aria-pressed`, not the picture.
- Clicking the range group's centre presses `30D`. Click each button by name.
- Balances above the chart say `Updating balances` until the first scan finishes. The price chart doesn't wait for it.
