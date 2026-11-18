# Account detail extras

A user reveals the full xpub on an account page. A bad account address shows an error instead of the page, and an archived account's address sends the user to the Archived section. This recipe archives a seeded account and restores it, so the run ends as it started.

## Sub-features

Proves: `xpub-reveal`, `unknown-id`, `archived-redirect`

## How to get to it (user POV)

- Accounts, an account's card.
- `/accounts/<account id>` directly.

## Driving it with the browser

Preconditions: the baseline.

- **Reveal**: open `Verify Watch Taproot`. The xpub reads `xpub 6Boe **** … rzEo 14r`. Click the eye button beside it. The full xpub shows, starting `xpub 6Boe XcVW 9Aby`.
- **Unknown ID**: go to `/accounts/re_clmx_doesNotExist0000000`: `An error occurred while loading the claim. Claim not found`. Go to `/accounts/not-an-id`: `Invalid claim ID in URL`.
- **Archived redirect**: open `Verify Watch Taproot`, click `Archive Account`, then the dialog's `Archive`. Go to that account's address again. The URL becomes `/accounts#archived` with `Verify Watch Taproot` listed under `Archived (1)`.
- **Restore**: click `Restore`. Toast `Account restored`; the header is back to `1.79999000 BTC`.
- **Stored proof**: `helpers/verify query --sql "SELECT id, display_name, deleted_at FROM accounts ORDER BY created_at"` into `stored.json`: no `deleted_at` on any seeded account.

## Gotchas

- The eye button has no accessible name. Find it beside the xpub, or click it where the screenshot shows it.
- Restore the account before the next recipe; later recipes expect all three seeded accounts.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
