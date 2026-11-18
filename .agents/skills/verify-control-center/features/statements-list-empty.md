# Statements empty state

A user with no statements opens Statements and is invited to generate one. This recipe changes no data.

## Sub-features

Proves: `empty`

## How to get to it (user POV)

- Statements in the navigation on a new install.

## Driving it with the browser

Preconditions: a fresh run with onboarding closed.

- **Empty**: click link `Statements`. `Your holdings, on record`, `Download a proof-of-ownership statement for a selected period.` and link `Generate Statement` (to `/statements/create`) show.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS statements FROM statements"` into `stored.json`: 0.

## Gotchas

- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
