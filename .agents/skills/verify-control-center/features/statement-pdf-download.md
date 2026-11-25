# Statement PDF preview and desktop download

In the packaged macOS Electron app, opening a completed statement renders the `@react-pdf/renderer` preview inside Electron's Chromium PDF viewer (`iframe[src^="blob:"]`) and clicking `Download` runs the real Electron `will-download` handler to save a valid, readable PDF containing the seeded statement details.

## Sub-features

Proves: `pdf-preview`, `download`

## How to get to it (user POV)

- Statements (`/statements`), then open `Verify Seed` (or any completed statement) and click `Download`.

## Driving it with CDP (`helpers/verify launch --electron` or `helpers/verify smoke`)

Preconditions: a seeded macOS run launched with `helpers/verify launch --electron` (or run automatically in Check 6 of `helpers/verify smoke`).

- **Open statement**: go to `/statements` and open `Verify Seed`.
- **Preview rendered**: wait for `iframe[src^="blob:"]` to appear and capture a screenshot showing the rendered PDF preview in Electron's Chromium viewer.
- **Real desktop download**: click `Download`. Verify Electron's verify-mode `will-download` handler saves a new `.pdf` file into `<runDir>/downloads/` without popping a blocking macOS save dialog.
- **Verify PDF contents**: confirm the saved file starts with `%PDF-`, is larger than 1,000 bytes, and its extracted text (including deflated streams and `ToUnicode` CMap glyphs) contains `Verify Seed` and `Verify Savings`. Copy the downloaded PDF into the attempt evidence folder.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, user_name FROM statements"` into `stored.json` shows the completed `Verify Seed` statement row.

## Gotchas

- `@react-pdf/renderer` (pdfkit) embeds subsetted TrueType fonts whose text streams encode glyph IDs through `ToUnicode` CMap tables. Use `tools/verify/pdf-text.ts` (`extractPdfText`) or the smoke check to decode and verify real PDF text.
- `helpers/verify smoke` exercises this end-to-end in Check 6 and archives `statement-verify-seed.pdf` in `verify-output/<run-id>/`.
