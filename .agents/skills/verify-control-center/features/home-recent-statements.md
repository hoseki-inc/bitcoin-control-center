# Home recent statements

A user sees their latest statements on Home, up to three cards with the period and when each was created, and opens one with View. The cards have no delete. This recipe changes no data.

## Sub-features

Proves: `recent-cards`, `recent-open`

`recent-status-badge` is not claimed: the seed has no pending or failed statement.

## How to get to it (user POV)

- Home, below the Bitcoin price.

## Driving it with the browser

Preconditions: the baseline, with the one seeded statement. Drive it before any recipe on the same run that adds a statement, or on a run of its own: a second statement adds a second card.

- **Card**: on `/home`, scroll to `Recent Statements`. One card reads `Statement`, `Period: Dec 31, 2025 - Jan 31, 2026` in America/New_York (the seeded period is January 2026 in UTC) and `Created:` with today's date. Its only control is button `View statement created <date>`.
- **Open**: click the card's `View`. The URL becomes `/statements/<id>` with `Statement Details`, `Verify Seed`, `Completed`, `Download` and `Delete`. The status badge's text is `completed`, capitalized by style, so match it ignoring case.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, user_name, timezone, opening_date, closing_date FROM statements"` into `stored.json`. The `id` matches the URL.

## Gotchas

- The card shows the period in the browser's time zone, not the statement's stored `timezone`. Compare against the browser's zone.
- After scrolling, a click by reference can miss the card. Click its `View` overlay where the screenshot shows it.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
