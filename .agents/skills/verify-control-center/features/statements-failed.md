# Failed statement generation

When the mempool server fails while a statement is generating, the statement ends as Failed with the reason. This recipe adds one failed statement.

## Sub-features

Proves: `generation-failed`

`interrupted` is not claimed: it needs Sentinel restarted mid-generation.

## How to get to it (user POV)

- Statements, then `Generate Statement`, while the mempool server is failing.

## Driving it with the browser

Preconditions: the baseline, with no fault on.

- **Error**: `helpers/verify fault mempool error`.
- **Generate**: on `/statements/create`, set `Start Date` `2026-02-01` and `End Date` `2026-03-31`, and click `Generate Statement`. The progress screen shows, then within seconds the statement's details read Status `Failed` with `Couldn't load all transactions.`, and `Download` is disabled.
- **List**: Statements shows the statement with a failed badge.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, error_message FROM statements ORDER BY created_at"` into `stored.json`: the new row `failed`.
- **Back**: `helpers/verify fault mempool ok`.

## Gotchas

- Put the fault right even if the recipe fails: the doctor fails while it is on.
- A click can miss while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
