# Statement details

A user opens a saved statement: the side panel shows contact details (or N/A), status, currency and period, the PDF switches between Full Period and Monthly, Delete removes it after asking, and Back to statements closes it. A missing or malformed ID shows an error. This recipe adds one statement and deletes one.

## Sub-features

Proves: `format-switch`, `delete`, `close`, `contact-na`, `unknown-id`

`pdf-preview` is not claimed: the PDF pane paints blank in the built-in browser. `download` is not claimed: it saves a file.

## How to get to it (user POV)

- Statements, then a statement's View.
- `/statements/<id>` directly.

## Driving it with the browser

Preconditions: at least one statement over two months, such as the Feb to Mar 2026 statement from `statement-generate-options`.

- **No contact**: generate a statement for `2026-04-01` to `2026-04-30` with `Name` cleared and `Address` empty. Its page shows Contact Details `N/A`, `Completed`, `Currency: USD`, `Period: Apr 1 - 30, 2026`.
- **Close**: click link `Back to statements`. The URL is `/statements`.
- **Format switch**: open the Feb to Mar statement. Under `Full Period` the PDF has one `SUMMARY: FEB 1 - MARCH 31, 2026`. Click `Monthly`: it is pressed, the PDF reloads, and it has `SUMMARY: FEB 1 - 28, 2026` and `SUMMARY: MAR 1 - 31, 2026`.
- **Delete**: on a statement's page, click `Delete`. The dialog `Delete statement?` says `This can't be undone.` Click its `Delete`. The URL is `/statements`, toast `Statement deleted`, and its card is gone.
- **Unknown ID**: go to the deleted statement's URL. After a few seconds: `Error: Statement not found`. Go to `/statements/not-an-id`: `Invalid statement ID provided in URL`.
- **Stored proof**: `helpers/verify query --sql "SELECT id, user_name, user_address, quote_currency, opening_date FROM statements ORDER BY created_at"` into `stored.json`: the April row has no name or address, and the deleted ID is absent.

## Gotchas

- The statement error takes several seconds. Wait for its text.
- The PDF pane can paint blank. Read the PDF's text from the iframe's `blob:` URL as the statements recipe describes. pdfkit writes ToUnicode ranges as `<start> <end> [<u1> <u2> …]`; read those arrays, or every glyph decodes to the wrong letter.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
