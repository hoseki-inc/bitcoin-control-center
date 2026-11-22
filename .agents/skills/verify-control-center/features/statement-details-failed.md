# Failed statement details

A failed statement's page shows the Failed status with its reason and offers no PDF to download. This recipe changes no data, or adds one failed statement if the run has none.

## Sub-features

Proves: `failed-statement`

## How to get to it (user POV)

- Statements, then a failed statement's `View`.

## Driving it with the browser

Preconditions: a failed statement for `2026-02-01` to `2026-03-31`, such as the one `statements-failed` leaves. To make one: `helpers/verify fault mempool error`, generate it on `/statements/create`, and `helpers/verify fault mempool ok` once it fails.

- **Details**: on `/statements`, click `View` on the card with the `Failed` badge. `Statement Details` reads Status `Failed` with `Couldn't load all transactions.`, `Currency: USD` and `Period: Feb 1 - Mar 31, 2026`. `Download` is disabled and no PDF shows.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, error_message FROM statements WHERE status = 'failed'"` into `stored.json`.

## Gotchas

- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
