# Home and Portfolio empty states

A user with no accounts and no statements sees Home invite them to add an account and to generate a statement, and Portfolio invite them to add their first account. This recipe changes no data.

## Sub-features

Proves: `no-accounts`, `no-statements`, `portfolio-empty`

## How to get to it (user POV)

- Home and Portfolio on a new install, after closing onboarding.

## Driving it with the browser

Preconditions: a fresh run with onboarding closed (run `onboarding` first).

- **No accounts**: on `/home`, `Your Bitcoin, in one place`, `Add your first wallet, exchange, or manually tracked holding.` and link `Add Account` (styled as a button, to `/accounts/add`) show above `0.00000000 BTC` and `0 tracked`.
- **No statements**: scroll down. `Your holdings, on record` and `Generate Statement` show where recent statements would be.
- **Portfolio**: click link `Portfolio`. `Watch your Bitcoin grow` and link `Add Your First Account` (to `/accounts/add`) show.
- **Stored proof**: `helpers/verify query --sql "SELECT (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM statements) AS statements"` into `stored.json`: both 0.

## Gotchas

- The intro paragraph has a second line, `Your wallets remain watch-only.` Match its first sentence, not the whole paragraph.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
