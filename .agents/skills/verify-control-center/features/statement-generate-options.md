# Statement options

A user generates a statement in another currency with their address on it, and one for a period with no activity. The PDF shows the address exactly as typed, approximate values in the chosen currency with the rate source named, and a clear message when nothing happened in the period. This recipe adds two statements.

## Sub-features

Proves: `other-currency`, `address`, `empty-period`

`generation-progress` and `close-while-pending` are not claimed: with the local fakes a statement completes in about a second, so there is no percentage to read and no time to close the progress screen.

## How to get to it (user POV)

- Statements, then `Generate Statement`.

## Driving it with the browser

Preconditions: the baseline, with a name saved in Settings (`statement-form` saves `Verify Owner`).

- **EUR with an address**: on `/statements/create`, click the `Contact Information (optional)` toggle. `Name` reads the saved name. Set `Start Date` `2026-02-01`, `End Date` `2026-03-31`, `Currency` `EUR`, and type `12 Verify Lane`, Shift+Enter, `Testville, TS 00000` in `Address`. Click `Generate Statement`.
- **Details**: the URL becomes `/statements/<id>` with `Completed`, the name and both address lines under Contact Details, `Currency: EUR` and `Period: Feb 1 - Mar 31, 2026`.
- **PDF, EUR**: the text has `PROVIDED BY USER`, the name, `12 Verify Lane` and `Testville, TS 00000`, `APPROX. EUR VALUE: EUR 1,307.13`, opening `0.50000000 BTC` (EUR 978.50), money in `0.25000000`, money out `0.10001000`, closing `0.64999000 BTC`, both transactions with EUR values, and a note that EUR values use saved Bitcoin-to-EUR rates from the configured mempool.
- **Quiet period**: generate another statement for `2026-06-01` to `2026-06-30` in USD. Its PDF shows opening and closing `0.74999000 BTC`, nothing in or out, and on the account page `No Transactions to Display` and `There were no transactions or balance changes during this period.`
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, quote_currency, user_name, user_address, opening_date, closing_date, error_message FROM statements ORDER BY created_at"` into `stored.json`: both new rows `completed`; the EUR row has `quote_currency` `EUR` and `user_address` with its newline.

## Gotchas

- EUR values follow the fake price on each date, so they are fixed for these dates.
- A rate column only appears on the cover page of a combined statement, not on a single statement.
- The `Contact Information (optional)` heading is inside its toggle button. If a click on the heading does not open it, click the button itself.
- The PDF pane can paint blank. Read the PDF's text from the iframe's `blob:` URL as the statements recipe describes. pdfkit writes ToUnicode ranges as `<start> <end> [<u1> <u2> …]`; read those arrays, or every glyph decodes to the wrong letter.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
