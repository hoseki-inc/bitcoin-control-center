# Slow statement generation

With a slow mempool server, a statement takes long enough to watch: the progress screen counts up in percent, and closing it leaves the statement generating, marked pending on Statements. This recipe adds two statements.

## Sub-features

Proves: `generation-progress`, `close-while-pending`

## How to get to it (user POV)

- Statements, then `Generate Statement`, while the mempool server is slow.

## Driving it with the browser

Preconditions: the baseline, with no fault on.

- **Slow**: `helpers/verify fault mempool slow`. Every mempool answer now takes five seconds.
- **Progress**: on `/statements/create`, set `Start Date` `2026-02-01` and `End Date` `2026-03-31`, and click `Generate Statement`. The URL becomes `/statements/<id>` with `Generating Your Statement`, `This may take a few minutes.` and a percentage below 100, such as `39%`, in the progress ring. It reaches `100%` about five seconds later, then the statement's details show `Completed`.
- **Close while pending**: generate another for the same dates. While the percentage shows, click the progress screen's close button (`Close`, top left). Statements shows the new statement first with a `Pending` badge, then, within seconds and without a reload, as finished.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, opening_date, closing_date FROM statements ORDER BY created_at"` into `stored.json`: both new rows `completed`.
- **Back**: `helpers/verify fault mempool ok`.

## Gotchas

- Generation takes about five seconds with this fault, so click Close within a second or two of starting, and read the list at once.
- The first click on `Generate Statement` after filling the dates is often lost. Check the URL changed before going on.
- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A click can miss while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
