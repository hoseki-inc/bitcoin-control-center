# Statement form with no accounts

A user with no verified account opens the statement form and is told to connect an account first. This recipe changes no data.

## Sub-features

Proves: `no-eligible-accounts`

## How to get to it (user POV)

- Statements, then `Generate Statement`, on a new install.

## Driving it with the browser

Preconditions: a fresh run with onboarding closed.

- **No accounts**: on `/statements`, click link `Generate Statement`. The URL is `/statements/create` with `First, Connect an Account.` and link `Connect Wallet` (to `/accounts/add`). There are no date fields or Generate button.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS accounts FROM accounts"` into `stored.json`: 0.

## Gotchas

- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
