# Accounts empty state

A user with no accounts opens Accounts and is invited to add their first one. This recipe changes no data.

## Sub-features

Proves: `empty`

## How to get to it (user POV)

- Accounts in the navigation on a new install.

## Driving it with the browser

Preconditions: a fresh run with onboarding closed.

- **Empty**: click link `Accounts`. `No accounts connected yet`, `Connect a wallet or exchange to see your Bitcoin balance and start verifying your ownership.` and link `Add Your First Account` (to `/accounts/add`) show.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS accounts FROM accounts"` into `stored.json`: 0.

## Gotchas

- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
