# Statement form checks

A user fills in the statement form. The Name starts with the name saved in Settings, the End Date can't be later than two days ago, and Generate Statement refuses a start after the end, a start before April 1, 2023, or a range over two years. With no account ticked, Generate is disabled. Cancel returns to the page the form was opened from. This recipe saves a name in Settings and creates no statement.

## Sub-features

Proves: `name-prefill`, `end-date-clamp`, `start-after-end`, `too-early`, `too-long`, `none-selected`, `cancel`

## How to get to it (user POV)

- Statements, then `Generate Statement`.
- Portfolio, then `Generate Statement`.

This recipe drives both, for Cancel.

## Driving it with the browser

Preconditions: the baseline. Today is the run's date; the examples below are for 2026-11-18.

- **Save a name**: on `/settings`, type `Verify Owner` in `Your name` and press Enter. Toast `Name saved`.
- **Open the form**: click link `Statements`, then link `Generate Statement`. The URL is `/statements/create`. `Start Date` is 90 days before `End Date`, `End Date` is two days ago (`2026-11-16`) and its `max` is the same day. `Verify Savings` is ticked.
- **Name prefill**: expand `Contact Information (optional)`. `Name` reads `Verify Owner`.
- **End date clamp**: set `End Date` to today and move focus away. It reads two days ago again.
- **Start after end**: set `Start Date` `2026-10-01` and `End Date` `2026-09-01`, click `Generate Statement`. Toast `Start date must be before end date`; the URL stays `/statements/create`.
- **Too early**: `2023-03-01` to `2023-12-31`, Generate. Toast `Statements must start on or after April 1, 2023.`
- **Too long**: `2023-06-01` to two days ago, Generate. Toast `Statement date range cannot exceed 2 years`.
- **None selected**: untick `Verify Savings`. `Total` reads `$0.00` and `Generate Statement` is disabled.
- **Cancel**: link `Cancel` points to `/statements`; click it. The URL is `/statements`.
- **Cancel from Portfolio**: on `/portfolio`, click `Generate Statement`. `Cancel` now points to `/portfolio`; click it. The URL is `/portfolio`.
- **Stored proof**: `helpers/verify query --sql "SELECT (SELECT value FROM settings WHERE key='user_name') AS user_name, (SELECT count(*) FROM statements) AS statements"` into `stored.json`: `Verify Owner`, and the statement count unchanged.

## Gotchas

- The date checks run on Generate, as toasts; the form shows nothing while typing. Too early and too long come back from Sentinel, so allow a second.
- Use form_input for the dates.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
