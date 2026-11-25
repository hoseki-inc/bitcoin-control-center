---
name: verify-control-center
description: Launch Bitcoin Control Center's web app on a fresh, seeded data folder with local fake Electrum and mempool servers, drive a feature the way a user does in your own browser, and leave evidence in verify-output/. Use to prove a change to Control Center or Sentinel works in the real app, or to walk the feature map in features/ before a release.
---

# Verify Control Center

Drives the standalone web app: Sentinel serving the built UI from one origin, as StartOS and Umbrel do. Each run gets its own scratch folder, data folder and free ports, so runs can sit side by side and never touch `pnpm dev` or its data. Runs belong to the checkout that launched them; another worktree never sees them. Sentinel talks only to local fakes of Electrum and mempool that serve a made-up chain and made-up prices.

Every command runs from the repository root through `.agents/skills/verify-control-center/helpers/verify`, written `helpers/verify` here. Pass `--run <id>` when this checkout has more than one run.

What to verify, and what each feature needs before it can be driven, is in [features/README.md](features/README.md) and [features/map.json](features/map.json).

## Launch

1. Install dependencies once: `corepack pnpm install`.
2. Start a run: `helpers/verify launch`. It builds the web app, starts the fakes and Sentinel, sets the fake mempool as the only price source with fallbacks off, and prints the run ID and URL. It returns once the app is usable. It can take a few minutes, so give it a 5-minute timeout or run it in the background. If it is interrupted, run cleanup: it stops whatever launch had started.
3. Seed it: `helpers/verify seed`. Through Sentinel's API it adds:
   - `Verify Savings`, verified by signing its ownership challenge with a public test key. Holds 0.74999 BTC.
   - `Verify Watch Segwit`, watch-only, 1 BTC.
   - `Verify Watch Taproot`, watch-only, 0.05 BTC.
   - One completed statement for January 2026, named `Verify Seed`.

   The seeded chain has `Verify Savings` deposits on 2026-01-10 (0.5 BTC) and 2026-02-05 (0.25 BTC), a payment on 2026-03-01 (0.1 BTC out, 0.39999 BTC change) and a deposit on 2026-04-15 (0.1 BTC). Prices are made up: $1,000 on January 1, 2023 plus $1 a day, far below any real price, so a real-looking price means the app reached a real service.

4. Run the doctor. Drive only after it passes.

For journeys that need an empty app, such as onboarding, launch with `helpers/verify launch --fresh` and skip the seed. The doctor then expects no seed; accounts a journey adds are fine.

For features the map marks `desktop-web`, such as Electrum settings, launch with `helpers/verify launch --desktop`. Sentinel and the web app then run as the desktop app does, in your browser with no Electron shell, so features the map marks `electron` or `packaged` stay unreachable. `--desktop` combines with `--fresh`.

For features the map marks `electron` or `packaged` on macOS, launch the real packaged macOS app with `helpers/verify launch --electron`:

- Builds the unsigned ad-hoc macOS app via `./desktop/build.sh --mac-dir` (reusing `desktop/node_modules` when `package-lock.json` is unchanged), or reuses a prebuilt bundle via `--app <path>`.
- Copies `Bitcoin Control Center.app` into the run's scratch folder and launches it with an isolated `--user-data-dir`, a loopback-only `BCC_VERIFY_CONFIG`, and `--remote-debugging-port=<free-port>` on `127.0.0.1` so nothing ever touches `~/Library/Application Support/desktop` or `desktop-dev`.
- Desktop PINs are always enabled (`246813` by default, or unset with `--setup-pin-in-ui` so the first-run PIN setup UI is driven directly).
- Release checks are disabled by default; pass `--release-tag <tag>` (for example `v99.0.0_0`) to serve that tag from the local fake `/latest.json` endpoint.
- `--electron` does not combine with `--desktop` or `--pin`.

For a repeatable end-to-end gate (for example on Electron bumps or desktop PRs), run `helpers/verify smoke [--app <path>] [--tor-mode online|allow-offline] [--keep]`. It builds and launches the packaged macOS `.app` with `--setup-pin-in-ui`, drives the real Electron BrowserWindow over CDP with `playwright-core`, verifies PIN setup/lock/unlock, Home seeded balances, hide-on-close, single-instance lock, desktop Settings (Electrum profile add/test/connect/delete, Statement data source persistence, Your name, SQLite WAL via `libsql`), bundled Tor startup, statement PDF preview and real Electron download, runtime hygiene, and clean `SIGTERM` shutdown with zero survivors. Evidence is written to `verify-output/<run-id>/` (`smoke.json`, `report.md`, `trace.md`, `stored.json`, screenshots, `statement-verify-seed.pdf`, and `logs/`). `--tor-mode online` is the default; `--tor-mode allow-offline` still fails on missing/broken binaries or SOCKS bind errors and flags post-SOCKS bootstrap timeouts explicitly as `offline-unverified`.

Launching a run that is already up does nothing. Seeding a seeded run does nothing; a half-seeded run is refused: launch a new one.

PINs are off unless you launch with `--pin` (Umbrel rules) or `--electron` (desktop rules). With `--pin`, Sentinel uses Umbrel's PIN rules and launch sets the run's test PIN, `246813`. The browser starts signed out: enter that PIN to sign in. The helper commands sign in with it as their own tab, so a recipe that changes the PIN must change it back before the next helper command. Wrong PINs make every sign-in wait, the helper's included. `--pin` doesn't combine with `--desktop` (whose PIN needs the Electron shell) or `--electron` (which enables desktop PINs automatically).

For features the map marks `fault`, make a fake fail on purpose: `helpers/verify fault electrum|mempool down|slow|error`. `down` refuses connections, `slow` holds every answer for five seconds, and `error` fails every request, though Electrum still answers keepalives so Sentinel stays connected. `ok` puts the fake right. The command returns once the fakes act on it. Put every fault right before the recipe ends: the doctor fails while one is on, and so does `ports` while a fake is down.

Never verify against `pnpm dev` or `turbo`: turbo drops `DATA_DIR`, so Sentinel would open the developer's own `apps/api-sentinel/data`.

## Doctor

`helpers/verify doctor`. It is read-only, prints one PASS or FAIL per check, and exits 1 if any failed. Run it before driving, after each journey, and whenever something looks off.

| Check                                                    | On FAIL                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                                                    | No run state, or it does not parse. Launch one.                                                                                                            |
| `sentinel process` / `electron process`, `fakes process` | The recorded PID exited or was reused. Clean up and relaunch.                                                                                              |
| `ports`                                                  | This run's processes do not own their ports (including CDP on `--electron`). Clean up and relaunch; never drive a port another process holds.              |
| `isolation` (`--electron` only)                          | `userDataDir` is missing or not isolated inside the scratch run folder and outside `~/Library/Application Support`. Clean up and relaunch.                 |
| `build`                                                  | The code changed since launch, so the running app is not the code under test. Clean up and relaunch. Edits to this skill's own files do not count.         |
| `health`, `web app`                                      | Sentinel is up but not serving. Read `logs/sentinel.log` or `logs/electron.log` in the run folder.                                                         |
| `pin`                                                    | PIN mode doesn't match the launch flags (off for standalone, `umbrel` for `--pin`, `desktop` for `--electron`).                                            |
| `electrum`                                               | Sentinel is not connected to this run's fake Electrum.                                                                                                     |
| `prices`                                                 | The fake mempool is not the only price source. A journey changed the price settings; launch a new run.                                                     |
| `seed`                                                   | Not seeded, or a journey removed a seeded account or the seeded statement. Seed, or launch a new run for later journeys that need the baseline.            |
| `faults`                                                 | A fault is still on. Put it right with `helpers/verify fault <target> ok`.                                                                                 |
| `fake coverage`                                          | A fake could not serve a request. The journey may have shown an error the real services would not; extend `tools/verify/fakes.ts` before trusting results. |

## Drive

For web runs (`launch`, `--desktop`, `--pin`), use your own browser tool on the URL launch printed, such as `http://127.0.0.1:61664`. In the Claude desktop app that is the built-in browser: open the URL with `preview_start`, read the page with `read_page` or `find`, act with `computer` or `form_input`, and capture with `computer` screenshots. If your harness has no browser, record each journey as unreachable with the reason `no browser in this harness`.

For `--electron` runs, drive the real Electron BrowserWindow over CDP at the `cdp` URL launch printed (`http://127.0.0.1:<cdpPort>`) using `playwright-core` `chromium.connectOverCDP`, or run `helpers/verify smoke` for the full automated Mac desktop smoke. Ledger/Trezor hardware wallet testing and macOS administrator PIN-reset prompts remain manual/interactive checks.

- Read the feature's recipe before driving. It lists the entry points, the exact handles and the end state that proves the feature works.
- Find elements by role and accessible name, never by coordinates or tab order. Take a fresh snapshot after every navigation, since references go stale.
- Wait for the state the recipe names, such as a status or a row, rather than a fixed delay. Balances say `Updating balances` until the first scan finishes.
- Read stored state through the second view the recipe names, and through the database: `helpers/verify query --sql "SELECT ..."` (read-only).
- Treat every name, value and command in a recipe as literal.
- A recipe that changes data says so; later recipes in the same run must allow for it.
- Never call Sentinel's API to do what the journey should do through the UI, and never write to the database. The seed is the only setup that skips the UI.

## Evidence

Evidence goes in `verify-output/<run-id>/`, which git ignores.

Evidence is recorded per recipe, the recipe file name without `.md` (`statements` for `statements.md`). A journey without a recipe can't be recorded: write its recipe and its map entry first.

1. Before the first recipe: `helpers/verify evidence start`. It writes `evidence.json` with the commit, whether the code had uncommitted changes at launch, whether the run is seeded or fresh, the URL and versions (including Electron and Chromium versions on `--electron` runs).
2. Before driving a recipe: `helpers/verify evidence begin <recipe>`. It needs the run to be live and still running the code it launched with, checks the recipe, saves what the recipe proves at that moment, opens a new, empty attempt folder, `verify-output/<run-id>/<recipe>/attempt-<n>/`, and prints its path. Save this attempt's evidence there, and nowhere else:
   - `trace.md`: one line per step, in order: the action, the handle used, and what the page showed afterwards.
   - `NN-<step>.jpg` (or `.png`): a screenshot of the state after each key action, with the app header visible where the page allows. In the Claude desktop app the screenshot result names the saved image file; copy it here with its own extension.
   - `NN-<step>.aria.txt`: the accessibility snapshot (`read_page` output) of the same state.
   - `stored.json`: the `helpers/verify query` output that proves the side effect was stored.
3. Record the outcome: `helpers/verify evidence record <recipe> --status verified|failed|unreachable [--reason "<text>"]`. It closes the recipe's open attempt. The feature and the sub-features it proves come from what `begin` saved, not from you, so editing the map mid-attempt changes nothing. A verified outcome needs `trace.md` and a screenshot in that attempt's folder. A verified outcome also needs the same live Sentinel the attempt began on, still running the code it launched with; after a crash, a relaunch or a code edit, record it as `failed` or abandon it. One attempt per recipe is open at a time: to give one up without a result, run `helpers/verify evidence abandon <recipe>`, which keeps the recipe's earlier result in the report, then `begin` again. The report shows each recipe's latest outcome and keeps older attempts' folders. A broken step is `failed` with what broke; a missing precondition is `unreachable` with that precondition. The reason is required for both.

`report.md` is the record of what was verified. The map never claims it.

Proof standards:

- Exercise the real user path. No internal setters, test-only routes, direct API calls or database writes.
- Capture the action and the resulting state, not only the final screen.
- Verify the side effect: a row in the database and a second view in the app, alongside what the screen showed.
- Mocks only at boundaries production already isolates: Electrum and mempool are fakes, nothing inside Sentinel or the UI is.
- Never weaken a journey to make it pass. A missing precondition makes the journey unreachable, and the reason goes in that recipe's `Gotchas`.
- Do not report an entry point as verified through a different one.

## Cleanup

`helpers/verify cleanup`. It stops every process launch recorded, only while it is still that process, copies the run's logs to `verify-output/<run-id>/logs/`, and deletes the scratch folder. On `--electron` runs it signals the Electron leader with `SIGTERM` first so `before-quit` stops Sentinel and Tor cleanly before escalating. It never kills by name or port and never deletes anything in `verify-output/`. Run it after every run, failed and interrupted ones included.

## Helpers

`helpers/verify <command> [args]` runs `tools/verify/<command>.ts` with tsx from the repository root.

| Command                                                                                                                     | Does                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `launch [--run <id>] [--fresh] [--desktop \| --pin \| --electron [--app <path>] [--setup-pin-in-ui] [--release-tag <tag>]]` | Builds the UI or macOS `.app`, starts fakes and Sentinel/Electron, waits until usable. |
| `smoke [--run <id>] [--app <path>] [--tor-mode online\|allow-offline] [--keep]`                                             | Runs the automated macOS packaged Electron end-to-end smoke and writes evidence.       |
| `seed`                                                                                                                      | Adds the baseline accounts and statement.                                              |
| `doctor`                                                                                                                    | The read-only checks above.                                                            |
| `query --sql "SELECT ..."`                                                                                                  | Prints rows from the run's database as JSON, read-only.                                |
| `fault <electrum or mempool> <ok, down, slow or error>`                                                                     | Makes a fake fail on purpose, or puts it right.                                        |
| `evidence start`                                                                                                            | Starts `evidence.json` and `report.md`.                                                |
| `evidence begin <recipe>`                                                                                                   | Opens a recipe's next attempt and its empty folder, on a live run.                     |
| `evidence record <recipe> --status <status> [--reason <text>]`                                                              | Closes the open attempt with its outcome and rewrites the report.                      |
| `evidence abandon <recipe>`                                                                                                 | Gives up the open attempt without an outcome.                                          |
| `cleanup`                                                                                                                   | Stops this run's processes, keeps its logs, removes its scratch folder.                |

The seed data and fakes live in `tools/verify/chain.ts` and `tools/verify/fakes.ts`.
