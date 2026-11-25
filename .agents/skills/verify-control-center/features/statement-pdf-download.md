# Statement PDF preview and desktop download

In the packaged macOS Electron app, a completed statement's PDF shows in the page, and `Download` saves `statement-<id>.pdf` in the format chosen, Full Period or Monthly, without a save dialog. This recipe adds one statement.

## Sub-features

Proves: `pdf-preview`, `download`

## How to get to it (user POV)

- Statements, then a statement's `View statement created …`.
- Home's Recent Statements, then a statement's `View statement created …`.
- `/statements/<id>` directly, as after generating a statement.

This recipe drives the first entry point for the seeded statement and the third for the one it generates.

## Driving it with CDP (`helpers/verify launch --electron`)

Preconditions: a seeded macOS run launched with `helpers/verify launch --electron` (or the run `desktop-shell` left), unlocked with `246813`. In verify mode Electron saves downloads in the run's `downloads` folder (`downloads:` in launch's output) instead of asking where.

- **Open the seeded statement**: click link `Statements`. The cards don't show statement names, so find the seeded one by its period, which covers January 2026 (see Gotchas), or as the earliest `View statement created …`. Click its `View statement created …`. The URL is `/statements/<id>`, Contact Details reads `Verify Seed`, Status `Completed`, with `Download` enabled.
- **Preview**: an iframe with a `blob:` source shows the rendered PDF, and the screenshot shows its first page. Electron's own PDF viewer draws it, which the built-in browser can't.
- **Download**: click `Download`. Within 30 seconds `logs/electron.log` in the run's scratch folder gains `verify-download:completed:statement-<id>.pdf` with this statement's ID, and that file is in the downloads folder. Move it to the attempt folder as `seed-full-period.pdf`.
- **Two-month statement**: click link `Statements`, then `Generate Statement`. Set `Start Date` (`#opening-date`) to `2026-02-01` and `End Date` (`#closing-date`) to `2026-03-31`, leave `Verify Savings` checked, and click `Generate Statement`. The URL becomes `/statements/<id2>`; wait for Status `Completed` and `Period: Feb 1 - Mar 31, 2026`.
- **Download, Full Period**: with `Full Period` pressed, click `Download`. `statement-<id2>.pdf` arrives the same way. Move it as `full-period.pdf`.
- **Download, Monthly**: click `Monthly`; it is pressed and the preview reloads. Click `Download`. `statement-<id2>.pdf` arrives again. Move it as `monthly.pdf`.
- **Read the files**: all three start with `%PDF-`, are over 1,000 bytes and contain `Verify Savings` (read with `extractPdfText` from `tools/verify/pdf-text.ts`). `seed-full-period.pdf` also contains `Verify Seed`. `full-period.pdf` has one summary, `SUMMARY: FEB 1 - MARCH 31, 2026`. `monthly.pdf` has `SUMMARY: FEB 1 - 28, 2026` and `SUMMARY: MAR 1 - 31, 2026`.
- **Stored proof**: `helpers/verify query --sql "SELECT id, status, user_name, opening_date, closing_date FROM statements ORDER BY created_at"` into `stored.json`: two `completed` rows, whose IDs are the ones in the file names.

## Gotchas

- The seeded statement's period reads `Jan 1 - 31, 2026`, or `Dec 31, 2025 - Jan 31, 2026` in the `America/New_York` time zone. Accept either; both end on Jan 31, 2026.
- Connect with `chromium.connectOverCDP(url, { noDefaults: true })`. Without it Playwright takes over downloads: `electron.log` still says `completed`, but no file reaches the downloads folder.
- Both downloads of a statement have the same name, and Electron overwrites the earlier file. Move each file out before the next download.
- The seeded statement covers one month, so its Monthly PDF looks like Full Period. That is why the recipe generates a two-month statement.
- pdfkit writes text through `ToUnicode` maps. Read it with `extractPdfText`, not `strings`.
- `helpers/verify smoke` downloads the seeded statement's Full Period PDF in its check 6.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
