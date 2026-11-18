# Not found

A user who follows a bad link sees `Page not found` with a way back to Home, without the header. Unknown IDs under `/accounts`, `/statements` and `/multisig` reach those detail pages instead, each with its own error. This recipe changes no data.

## Sub-features

Proves: `nf-page`, `nf-which-paths`

## How to get to it (user POV)

- A mistyped or stale address.

## Driving it with the browser

Preconditions: a launched run.

- **Unknown path**: go to `/no-such-page`. `Page not found`, `Sorry, we can't find the page you're looking for.` and link `Back to Home` show, with no header.
- **Back to Home**: click it. The URL becomes `/home`.
- **Unknown account**: go to `/accounts/re_clmx_doesNotExist0000000`. The header shows, with `An error occurred while loading the claim. Claim not found`.
- **Unknown statement**: go to `/statements/st_stmt_doesNotExist000000`. The header shows, with `Error: Statement not found`.
- **Unknown multisig**: go to `/multisig/doesNotExist`. The header shows, with `Invalid wallet ID`.
- **Stored proof**: save each URL's page text into `stored.json`.

## Gotchas

- The statement error can take several seconds to show. Wait for its text.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
