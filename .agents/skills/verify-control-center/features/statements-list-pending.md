# Pending statement on the list

While a statement is generating, its card on Statements has no Delete control; the control appears once it finishes. This recipe adds one statement.

## Sub-features

Proves: `no-delete-while-pending`

## How to get to it (user POV)

- Statements, while a statement is still generating.

## Driving it with the browser

Preconditions: the baseline, with no fault on.

- **Slow**: `helpers/verify fault mempool slow`.
- **Pending**: on `/statements/create`, set `Start Date` `2026-02-01` and `End Date` `2026-03-31`, click `Generate Statement`, then at once click the progress screen's close button (`Close`, top left). On `/statements`, the new card has a pending badge and `View`, but no `Delete statement` button, while the other cards have one.
- **Finished**: without a reload, the card loses its badge and gains `Delete statement`.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status FROM statements ORDER BY created_at"` into `stored.json`: the new row `completed`.
- **Back**: `helpers/verify fault mempool ok`.

## Gotchas

- Generation takes about five seconds with this fault: close the progress screen a second after starting, then take the screenshot and read the page at once. The first screenshot can still show the progress screen; take another.
- The first click on `Generate Statement` after filling the dates is often lost. Check the URL changed before going on.
- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
