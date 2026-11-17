# Statements

A user generates a proof-of-ownership statement: they pick a date range, a currency and the accounts they have proven they own, choose Generate Statement, and land on the new statement while it generates. It then shows in the statement list with its period, and its details page lists the transactions and balances for that period. Only verified self-custody accounts can be picked.

## Sub-features

Proves: `generate`, `watch-only-excluded`, `listed`, `details`, `pdf-content`

The progress view (`generation-progress`) may finish before the first read, so this recipe does not claim it. Run `helpers/verify evidence begin statements` before driving it and `helpers/verify evidence record statements --status <status>` after.

## How to get to it (user POV)

- Statements in the navigation, then the `Generate Statement` button in the page header.
- `/statements/create` directly.
- The `Generate Statement` banner on Statements or Home when there are no statements.
- Portfolio's `Generate Statement`, which preselects the accounts in view.
- `Generate Statement` on the receipt after an account is verified.

This recipe drives the first entry point only.

## Driving it with the browser

Preconditions: the baseline. `Verify Savings` is the only verified account; the seed's January 2026 statement `Verify Seed` already exists. This recipe adds one statement, so a later recipe in the same run sees two.

- **Open Statements**: click link `Statements` in the navigation. The heading `Statements` shows and the seeded statement is listed.
- **Start a statement**: click button or link `Generate Statement`. The URL becomes `/statements/create` and the panel `Generate Statement` shows `Customize Your Statement`.
- **Set the period**: set `Start Date` (input `#opening-date`) to `2026-02-01` and `End Date` (input `#closing-date`) to `2026-03-31`. Both fields show those dates.
- **Currency**: leave `Currency` on `USD`.
- **Contact information**: expand `Contact Information (optional)` and type `Verify Tester` in `Name`. Leave `Address` empty.
- **Pick the account**: under `Select Accounts`, checkbox `Verify Savings` is listed and already checked; leave it checked. `Verify Watch Segwit` and `Verify Watch Taproot` are absent. Button `Generate Statement` is enabled.
- **Generate**: click button `Generate Statement`. The URL becomes `/statements/<id>`. A progress view may show briefly; wait for Status `Completed`.
- **Read the statement**: the side panel shows Contact Details `Verify Tester`, Status `Completed`, `Currency: USD` and `Period: Feb 1 - Mar 31, 2026`. The statement itself is a PDF in the page. It names `Verify Tester` and `Verify Savings`, shows an opening balance of 0.50000000 BTC, money in 0.25000000 BTC, money out 0.10001000 BTC and a closing balance of 0.64999000 BTC, and lists two transactions: 2026-02-05 in 0.25 BTC and 2026-03-01 out 0.10001 BTC.
- **Second view**: click link `Statements` in the navigation. The new statement is listed for February to March 2026 beside `Verify Seed`.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, opening_date, closing_date, account_ids, user_name, quote_currency, tx_source, error_message, (SELECT json_group_object(json_extract(value, '$.displayName'), json_array_length(value, '$.transactions')) FROM json_each(transaction_map)) AS transactions FROM statements ORDER BY created_at"` into `stored.json`. The new row has `status` `completed`, the chosen dates, one account ID, `user_name` `Verify Tester`, `quote_currency` `USD`, `tx_source` `node_mempool`, no error, and `transactions` `{"Verify Savings":4}`: the stored map holds the account's whole history, and the statement shows the two in the period.

## Gotchas

- Watch-only accounts never appear in statements. Seed only finishes once `Verify Savings` is verified, so on a run whose doctor passed, a `Select Accounts` list without it is a failure, not a missing precondition.
- Only End Date clamps, to two days ago. A typed Start Date before April 2023, or a range over two years, is refused with a toast and nothing is saved.
- Dates are the browser's local days, so stored dates carry its time zone offset. Compare days, not exact timestamps.
- The seeded statement is January 2026. Use a different period so the new statement is distinguishable in the list.
- Statement generation reads address history from the fake Electrum and transactions and prices from the fake mempool. If the doctor's `electrum` or `fake coverage` check fails afterwards, the statement may show an error the real services would not produce.
- The page fades out before opening the new statement. Wait for the statement URL, not a fixed delay.
- The statement PDF can paint blank in a browser pane that is hidden or has no PDF viewer. Read its text instead: in the page, fetch the iframe's `blob:` URL without its `#toolbar=0` fragment, which makes the fetch fail. Inflate each content stream with `DecompressionStream('deflate')` after trimming the newline before `endstream`; otherwise it fails as junk, which surfaces as `Failed to fetch`. Map the glyph codes through each font's `ToUnicode` table; small print may decode garbled, the figures do not. Save that text beside the screenshot. Matching text proves `pdf-content`; a blank pane leaves the preview (`statement-details` `pdf-preview`) unproven, so say so in the trace. A PDF without the expected text is a failure.
- A navigation click right after the page loads can be lost. Check the URL after every click, and click again if it did not change.
- The expected dates hold for browser time zones from UTC-11 to UTC+11, since every seeded transaction is at noon UTC.
