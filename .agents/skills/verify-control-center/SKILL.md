---
name: verify-control-center
description: Launch Bitcoin Control Center's web app, or the packaged macOS Electron app (--electron), on a fresh, seeded data folder with local fake Electrum and mempool servers, drive a feature the way a user does (your own browser, or CDP for Electron), and leave evidence in verify-output/. Also runs the automated macOS desktop smoke (smoke). Use to prove a change to Control Center, Sentinel or the desktop app works in the real app, or to walk the feature map in features/ before a release.
---

# Verify Control Center

Drives the standalone web app (Sentinel serving the built UI from one origin, as StartOS and Umbrel do), or with `--electron` the packaged macOS app over CDP. `smoke` runs a fixed end-to-end check of the packaged app. Each run gets its own scratch folder, data folder and free ports, so runs can sit side by side and never touch `pnpm dev` or its data. Runs belong to the checkout that launched them; another worktree never sees them. Sentinel talks only to local fakes of Electrum and mempool that serve a made-up chain and made-up prices.

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
- Desktop PINs are always enabled (`246813` by default, or unset with `--setup-pin-in-ui` so the first-run PIN setup UI is driven directly). On a `--setup-pin-in-ui` run, `seed` refuses until the PIN is set in the app; set `246813` there, then run `seed`. It also makes the fake mempool the only price source, which launch can't do before a PIN exists. With `--fresh --setup-pin-in-ui` the run stays fresh: `seed` refuses even after the PIN is set, so the price settings stay as the app left them and the doctor's `prices` check fails.
- Release checks are disabled by default; pass `--release-tag <tag>` (for example `v99.0.0_0`) to serve that tag from the local fake `/latest.json` endpoint.
- `--electron` does not combine with `--desktop` or `--pin`.

For a repeatable end-to-end gate (for example on Electron bumps or desktop PRs), run `helpers/verify smoke [--app <path>] [--tor-mode online|allow-offline] [--keep]`. It builds and launches the packaged macOS `.app` with `--setup-pin-in-ui`, drives the real Electron BrowserWindow over CDP with `playwright-core`, verifies PIN setup/lock/unlock, Home seeded balances, hide-on-close, single-instance lock, desktop Settings (Electrum profile add/test/connect/delete, Statement data source persistence, Your name, SQLite WAL via `libsql`), bundled Tor startup, statement PDF preview and real Electron download, runtime hygiene, and clean `SIGTERM` shutdown with zero survivors. Evidence is written to `verify-output/<run-id>/` (`smoke.json`, `report.md`, `trace.md`, `stored.json`, screenshots, `statement-verify-seed.pdf`, and `logs/`). `--tor-mode online` is the default; `--tor-mode allow-offline` still fails on missing/broken binaries or SOCKS bind errors and flags post-SOCKS bootstrap timeouts explicitly as `offline-unverified`.

Launching a run that is already up does nothing. Seeding a seeded run does nothing; a half-seeded run is refused: launch a new one.

PINs are off unless you launch with `--pin` (Umbrel rules) or `--electron` (desktop rules). With `--pin`, Sentinel uses Umbrel's PIN rules and launch sets the run's test PIN, `246813`. The browser starts signed out: enter that PIN to sign in. The helper commands sign in with it as their own tab, so a recipe that changes the PIN must change it back before the next helper command. Wrong PINs make every sign-in wait, the helper's included. `--pin` doesn't combine with `--desktop` (whose PIN needs the Electron shell) or `--electron` (which enables desktop PINs automatically).

For features the map marks `fault`, make a fake fail on purpose: `helpers/verify fault electrum|mempool down|slow|error`. `down` refuses connections, `slow` holds every answer for five seconds, and `error` fails every request, though Electrum still answers keepalives so Sentinel stays connected. `ok` puts the fake right. The command returns once the fakes act on it. Put every fault right before the recipe ends: the doctor fails while one is on, and so does `ports` while a fake is down.

Never verify against `pnpm dev` or `turbo`: turbo drops `DATA_DIR`, so Sentinel would open the developer's own `apps/api-sentinel/data`.

## Doctor

`helpers/verify doctor`. It is read-only, prints one PASS or FAIL per check, and exits 1 if any failed. Run it before driving, after each journey, and whenever something looks off. With `--save <attempt folder>` it also writes its output to that folder's next free `doctor-<n>.log`.

| Check                                                    | On FAIL                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                                                    | No run state, or it does not parse or names another run. Launch one; cleanup still clears the old folder.                                                                                                                                                                                                                           |
| `sentinel process` / `electron process`, `fakes process` | The recorded PID exited or was reused. Clean up and relaunch.                                                                                                                                                                                                                                                                       |
| `ports`                                                  | This run's processes do not own their ports (including CDP on `--electron`). Clean up and relaunch; never drive a port another process holds.                                                                                                                                                                                       |
| `isolation` (`--electron` only)                          | `userDataDir` is missing or not isolated inside the scratch run folder and outside `~/Library/Application Support`. Clean up and relaunch.                                                                                                                                                                                          |
| `build`                                                  | The code changed since launch, so the running app is not the code under test. Clean up and relaunch. Edits to this skill's own files do not count.                                                                                                                                                                                  |
| `health`, `web app`                                      | Sentinel is up but not serving. Read `logs/sentinel.log` or `logs/electron.log` in the run folder.                                                                                                                                                                                                                                  |
| `pin`                                                    | PIN mode doesn't match the launch flags (off for standalone, `umbrel` for `--pin`, `desktop` for `--electron`).                                                                                                                                                                                                                     |
| `electrum`                                               | Sentinel is not connected to this run's fake Electrum.                                                                                                                                                                                                                                                                              |
| `prices`                                                 | The fake mempool is not the only price source. A journey changed the price settings; launch a new run.                                                                                                                                                                                                                              |
| `seed`                                                   | Not seeded, or a journey removed a seeded account or the seeded statement. Seed, or launch a new run for later journeys that need the baseline.                                                                                                                                                                                     |
| `emulators`                                              | A recorded container isn't running on its daemon, a health or bridge check failed, a Ledger's screen isn't idle, a container create was interrupted, the run's records name two daemons for one container, or `containers.json` doesn't parse. Finish the prompt with `emulator press` or `reject`, or stop the device or clean up. |
| `faults`                                                 | A fault is still on. Put it right with `helpers/verify fault <target> ok`.                                                                                                                                                                                                                                                          |
| `fake coverage`                                          | A fake could not serve a request. The journey may have shown an error the real services would not; extend `tools/verify/fakes.ts` before trusting results.                                                                                                                                                                          |

## Drive

For web runs (`launch`, `--desktop`, `--pin`), use your own browser tool on the URL launch printed, such as `http://127.0.0.1:61664`. In the Claude desktop app that is the built-in browser: open the URL with `preview_start`, read the page with `read_page` or `find`, act with `computer` or `form_input`, and capture with `computer` screenshots. If your harness has no browser, record each journey as unreachable with the reason `no browser in this harness`.

For `--electron` runs, drive the real Electron BrowserWindow over CDP at the `cdp` URL launch printed, with `playwright-core` from a script inside this checkout (a gitignored spot such as `verify-output/` resolves the package):

```js
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { noDefaults: true })
const page = browser.contexts().flatMap((context) => context.pages())[0]
await page.screenshot({ path: `${attempt}/01-step.png` })
writeFileSync(`${attempt}/01-step.aria.txt`, await page.locator('body').ariaSnapshot())
```

- Pass `noDefaults: true`. Without it Playwright takes over downloads, and Electron's downloads never reach the run's `downloads` folder.
- `browser.close()` only disconnects; the app keeps running for the next script.
- Launch turns off Chromium's background throttling for the window. Without that, a window another window covers stops drawing frames, its animations never finish, and a click waiting for a control to settle times out.
- Without `--setup-pin-in-ui`, launch sets the PIN after the window has loaded, so the window can still show `Set up your PIN`. Reload the page, then wait for either the PIN prompt or the app: enter `246813` only if it asks. A tab already unlocked stays unlocked across a reload.
- CDP key events reach the page, not the macOS menu, so a script can't press `Cmd+W`. `kill -USR2 <electronPid>` closes the window the same way in verify mode.
- Build the `.app` once and reuse it on every later run with `launch --electron --app <path>` (for example `desktop/release/mac-arm64/Bitcoin Control Center.app`). Launch prints the bundle's commit and warns when it isn't the checkout's.
- Ledger and Trezor devices stay manual checks in the app: the Ledger emulator below runs, but the browser can't reach it yet. So do the tray menu, links that open the system browser, and the macOS administrator prompt for a PIN reset, which the map marks `manual`.

- Read the feature's recipe before driving. It lists the entry points, the exact handles and the end state that proves the feature works.
- Find elements by role and accessible name, never by coordinates or tab order. Take a fresh snapshot after every navigation, since references go stale.
- Wait for the state the recipe names, such as a status or a row, rather than a fixed delay. Balances say `Updating balances` until the first scan finishes.
- Read stored state through the second view the recipe names, and through the database: `helpers/verify query --sql "SELECT ..."` (read-only).
- Treat every name, value and command in a recipe as literal: drive exactly the control, value and route it names, and prove exactly the state it names. Match its text as the matching rules below say.
- A recipe that changes data says so; later recipes in the same run must allow for it.
- Never call Sentinel's API to do what the journey should do through the UI, and never write to the database. The seed is the only setup that skips the UI.

### Matching text

The words in a recipe are what a user reads. The accessibility tree often joins, splits or restyles them, so an exact string match fails on a correct page. Keep the recipe's words and match them this way:

- **Case**: status badges and labels are often capitalized by style, so the tree reads `completed` or `verified` where the screen shows `Completed`. Match status words ignoring case (`/^completed$/i`).
- **Whitespace**: an amount and its unit sit in separate elements, and the tree or `innerText` can read `1.79999000BTC` or break the line between them. Compare amounts and other multi-part text with whitespace collapsed or removed. Normalize PDF text the same way (`pdfTextIncludes` in `tools/verify/pdf-text.ts`).
- **Names that grow**: an accessible name can carry more than its visible title: `+ Add account`, a tile's description, a label's explanatory suffix (`Address (This will appear on the statement exactly as entered)`), or a reason a button is disabled (`New connection Limit reached. Delete one to add another.`). Match by the recipe's word as the name's prefix (`/^New connection/`), or by the whole name the recipe gives. Never match a different control that happens to share the word.
- **Shared nodes**: a sentence can share its node with a link (`Want more privacy? … Connect your node`). Match text as contained in the node, not as the whole node.
- **Scope**: when a word appears in more than one place (two `Dismiss` buttons, a `mempool.space` option in two sections, a label that also names a region), find the container first: the `status` holding the notice's text, the radio group under its heading, the textbox role. Ask for one match; more than one is a driver error, never a reason to take the first.
- **Hidden inputs**: Chakra hides checkboxes and switches behind a visible control. Find the input by its label to read its state, and click the visible label to change it.

A tolerant match is still a match for the recipe's words. Never widen it until something else on the page satisfies it, and never drop a word the recipe names.

### Waiting for readiness

- Wait for the state the recipe names becoming true: the text showing, `aria-current="page"` set, `aria-pressed="true"`, a status word. A URL change or a click returning doesn't mean the page has settled.
- Wait on visible text, not on its container. Some containers have no size of their own (the notices' `output` element with role `status`), so a visibility wait on them times out while their text shows.
- Counts and lists render after navigation. Wait for the item the recipe names before counting.
- Saved values load after the page draws: a checked radio or a field's value can still show its default just after the heading appears. Wait for the value to match rather than reading it once.
- A step that may or may not appear (a PIN prompt after reload on an already unlocked tab) is a race: wait for whichever of the two states comes first and branch on it. Never assume one.
- Fixed delays only before screenshots, so the capture isn't a frame behind.

### Test ids

Prefer role and accessible name. Add a `data-testid` to the app only when a control has no stable role and name a user would recognize, such as a chart's bars, and say in the recipe why the name doesn't work. A test id supplements the user handle; it never replaces a control the user can name.

### Runs and isolation

Recipes on one run share its database, its fakes and its faults. `evidence begin` refuses while another recipe is open on the same run, so two drivers can't overlap on one run.

- Drive the recipes on a run one at a time, in one driver.
- Give recipes that turn a fault on, and those that need a pristine baseline (exact statement or account counts), a run each or put them before recipes that add data. A recipe's `Preconditions` say which.
- A recipe whose precondition is another recipe's result (`settings-electrum` after `notices-public-server`) runs on the same run, after that recipe verified. If it didn't, record the later one `unreachable`.
- When a recipe stops partway, the run's data is no longer the baseline. Later recipes that need the baseline go on a new run.

### Retries

- One retry per recipe: a first attempt and one more, to tell a flake from a failure. `evidence begin` refuses a third recorded attempt on a run. Fix the cause and try again on a new run, which counts as a new attempt in the results.
- A pass after a failed first attempt is reported as `Verified on retry (flaky)`, with the earlier failure, until the cause is fixed. Never leave a failed attempt out of the totals.
- Abandon only an attempt that is open. Once recorded, an attempt stays.
- Keep every attempt's evidence. Save each doctor run with `helpers/verify doctor --save <attempt folder>`, which writes the next free `doctor-<n>.log`, so a recovery doctor never replaces the failed one. Put faults right before the recovery doctor, and say in the trace that you did.

## Evidence

Evidence goes in `verify-output/<run-id>/`, which git ignores.

Evidence is recorded per recipe, the recipe file name without `.md` (`statements` for `statements.md`). A journey without a recipe can't be recorded: write its recipe and its map entry first.

1. Before the first recipe: `helpers/verify evidence start`. It writes `evidence.json` with the commit, whether the code had uncommitted changes at launch, the baseline (`seeded`; `fresh` for any `--fresh` run, `--setup-pin-in-ui` included; or `unseeded` when a `--setup-pin-in-ui` run without `--fresh` starts evidence before `seed`), the URL and versions (including Electron and Chromium versions on `--electron` runs). On `--electron` runs the report adds an `App bundle:` line with the bundle's source, commit and release, and the release tag served. It refuses a run whose folder holds a smoke report (`smoke.json`): launch a new run ID for recipes.
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

`helpers/verify cleanup`. It stops every process launch recorded, only while it is still that process, removes every Docker container recorded for the run on the daemon that started it, copies the run's logs to `verify-output/<run-id>/logs/`, and deletes the scratch folder. On `--electron` runs it signals the Electron leader with `SIGTERM` first so `before-quit` stops Sentinel and Tor cleanly before escalating. It never kills by name or port, never removes a container it didn't record, and never deletes anything in `verify-output/`. Run it after every run, failed and interrupted ones included.

Cleanup exits 1 and keeps the scratch folder while any recorded container isn't confirmed gone: Docker is down, `docker rm` failed, or the recorded Docker endpoint now reaches another daemon, as after switching between Colima and Docker Desktop. The error names the daemon and context to go back to. Fix that and run cleanup again; it retries only what is left. It also exits 1 and keeps the folder when `containers.json` or `processes.json` does not parse, rather than forget what they list: stop those processes and containers by hand, then delete the folder. A `run.json` that does not parse, or names another run, doesn't stop cleanup when `processes.json` is there; without it nothing says which processes the run started, so cleanup removes what it can, exits 1 and keeps the folder. It also keeps any container whose `containers.json` and `run.json` records name different daemons, and never asks either daemon to remove it: fix the records by hand.

If the daemon that started a container is gone for good, for example after resetting Docker Desktop or `colima delete`, cleanup keeps failing: it can't confirm the container is gone. Its containers went with that daemon, so once you are sure the daemon no longer exists, delete the run folder the error names by hand.

## Weekly online smoke

Running the desktop smoke online in the weekly verify is planned; the weekly verify doesn't run it yet. Online mode needs bundled Tor to reach the public Tor network:

```bash
helpers/verify smoke --run weekly-electron-$(date +%Y%m%d) --tor-mode online
```

- Allow 20 minutes. A cold checkout downloads Tor and the Electron dependencies and builds the `.app` before Tor starts.
- In online mode a Tor start that doesn't reach 100% fails the run, and a failed run exits 1. Still read `smoke.json` rather than trusting the exit code: a pass has `status` `pass`, all nine steps `pass` (`launch`, then checks 1 to 8), `cleanedUp` true and no hygiene errors. (`offline-unverified` comes only from `--tor-mode allow-offline`, and it exits 0.)
- Report the commit, Electron and Chromium versions, each check's status and the evidence folder from `smoke.json` and `report.md`.
- The evidence lives in this checkout's `verify-output/`. Copy it out before deleting a temporary worktree.

## Helpers

`helpers/verify <command> [args]` runs `tools/verify/<command>.ts` with tsx from the repository root.

| Command                                                                                                                     | Does                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `launch [--run <id>] [--fresh] [--desktop \| --pin \| --electron [--app <path>] [--setup-pin-in-ui] [--release-tag <tag>]]` | Builds the UI or macOS `.app`, starts fakes and Sentinel/Electron, waits until usable.   |
| `smoke [--run <id>] [--app <path>] [--tor-mode online\|allow-offline] [--keep]`                                             | Runs the automated macOS packaged Electron end-to-end smoke and writes evidence.         |
| `seed`                                                                                                                      | Adds the baseline accounts and statement.                                                |
| `doctor [--save <attempt folder>]`                                                                                          | The read-only checks above; `--save` also writes them to the next free `doctor-<n>.log`. |
| `query --sql "SELECT ..."`                                                                                                  | Prints rows from the run's database as JSON, read-only.                                  |
| `fault <electrum or mempool> <ok, down, slow or error>`                                                                     | Makes a fake fail on purpose, or puts it right.                                          |
| `evidence start`                                                                                                            | Starts `evidence.json` and `report.md`.                                                  |
| `evidence begin <recipe>`                                                                                                   | Opens a recipe's next attempt and its empty folder, on a live run.                       |
| `evidence record <recipe> --status <status> [--reason <text>]`                                                              | Closes the open attempt with its outcome and rewrites the report.                        |
| `evidence abandon <recipe>`                                                                                                 | Gives up the open attempt without an outcome.                                            |
| `emulator start --device ledger [--model flex\|nanosp] [--seed primary\|secondary\|empty]`                                  | Starts a Speculos Ledger for the run (default Flex, primary seed). See Emulators.        |
| `emulator status [--device <device>]`                                                                                       | Shows each recorded emulator container, its state on its daemon, and a Ledger's screen.  |
| `emulator press --device ledger [--button <button>]`                                                                        | Approves the prompt on the Ledger, or presses one button.                                |
| `emulator reject --device ledger`                                                                                           | Rejects the prompt on the Ledger.                                                        |
| `emulator screenshot --device ledger [--recipe <id>] [--step <name>]`                                                       | Saves the Ledger's screen as `NN-ledger-<step>.png` in the open attempt.                 |
| `emulator stop --device ledger\|trezor\|coldcard`                                                                           | Stops that device's bridge and removes its containers; exits 1 and keeps any it can't.   |
| `cleanup`                                                                                                                   | Stops this run's processes and containers, keeps its logs, removes its scratch folder.   |

The seed data and fakes live in `tools/verify/chain.ts` and `tools/verify/fakes.ts`.

## Emulators

`emulator start --device ledger` runs Ledger's unmodified Speculos image in Docker with app-bitcoin 2.5.1, built from a pinned commit with a pinned builder image and cached in `~/.cache/bitcoin-control-center/ledger-elfs` (or under `BCC_VERIFY_CACHE_DIR`). The first start per model builds the app in about 10 seconds after the builder image is pulled; a build or cached file that doesn't match its pinned SHA-256 is refused. Seeds are the public test mnemonics in `tools/verify/emulator-seeds.ts`. One Ledger per run.

- `press` with no `--button` carries the prompt on screen through to approval, dismissing the Flex's result screen, and prints the screen it left: idle, or a prompt that came next, which it leaves alone. `reject` does the same to a rejection, which the app sees as `0x6985`. Both wait up to 5 seconds for a prompt and fail when none appears, so neither arms a decision for a later prompt. Both refuse a Ledger whose container isn't running on its daemon.
- `--button` presses one control: `left`, `right` or `both` on a Nano S Plus; `next`, `approve` or `dismiss` on a Flex.
- A screen the driver doesn't know, before or after the decision, stops it once a few seconds pass without a known screen, and the screen is saved to the run's `logs/`.
- `screenshot` writes into the recipe's open attempt (`--recipe`, or the only open one), or into `verify-output/<run-id>/` when none is open.

Trezor and Coldcard runners, and Ledger `disconnect` and `fault`, come in later changes; until then they exit 1 saying the runner is not implemented. The Control Center web app can't reach the Ledger emulator yet either.
