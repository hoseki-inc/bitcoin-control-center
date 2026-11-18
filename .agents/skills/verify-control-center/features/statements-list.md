# Statements list

A user browses saved statements as cards, each with its period, created time, View and Delete, or as a table, and deletes one from its card. The view goes back to cards after a reload. This recipe deletes one statement.

## Sub-features

Proves: `card-view`, `list-view`, `view-resets`, `delete`

`no-delete-while-pending` is not claimed: statements complete too fast to catch one pending. `empty` needs a fresh run.

## How to get to it (user POV)

- Statements in the navigation.

## Driving it with the browser

Preconditions: at least two statements.

- **Cards**: on `/statements`, each card reads `Statement`, `Period: …` and `Created: <date> <time>`, with buttons `View statement created <date> <time>` and `Delete statement created <date> <time>`. Buttons `List view` and `Card view` sit above.
- **List view**: click `List view`. A table shows `Generation Date`, `Requester`, `Status` and `Actions`, one row per statement with `Self-initiated`, `Completed` and `View`.
- **Reset**: reload the page. Cards show again.
- **Delete**: click a card's `Delete statement created …`. The dialog `Delete statement?` says `This can't be undone.` Click `Delete`. Toast `Statement deleted`; the card is gone.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, opening_date, closing_date, created_at FROM statements ORDER BY created_at"` into `stored.json`: one fewer row.

## Gotchas

- The seeded statement's card shows its period in the browser's time zone; see home-recent-statements.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
