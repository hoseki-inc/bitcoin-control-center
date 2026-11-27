# Desktop shell

In the packaged macOS Electron app, the desktop PIN gate always runs first on a fresh profile, closing the window hides the app to the tray and locks the PIN instead of quitting, and launching a second instance against the same data folder exits cleanly and shows the first window again.

## Sub-features

Proves: `close-to-hide`, `single-instance`, `pin-first`

`tray` and `external-links` are not claimed: clicking native macOS menu-bar tray items and checking that macOS opens the system browser stay manual checks.

## How to get to it (user POV)

- Launch the packaged macOS app (`Bitcoin Control Center.app`) on a fresh isolated profile.

This recipe drives that launch through `helpers/verify launch --electron --setup-pin-in-ui`.

## Driving it with CDP (`helpers/verify launch --electron --setup-pin-in-ui`)

Preconditions: a macOS run launched with `helpers/verify launch --electron --setup-pin-in-ui`, not yet seeded. Start evidence before setting the PIN; the report then says `not seeded when evidence started`.

- **PIN first**: connect over CDP (`http://127.0.0.1:<cdpPort>`). There is exactly one page target, `window.desktop.platform` is `darwin`, and the first screen is `Set up your PIN`. Type `246813` in `New PIN, 6 digits`, then `246813` in textbox `Confirm your PIN` (the page's main region carries the same name, so ask for the textbox). `Your PIN is set` shows with `Continue`.
- **Seed at the pause**: while `Your PIN is set` shows, run `helpers/verify seed`, then `helpers/verify doctor`. Seed sets the fake mempool as the only price source, so the doctor passes, `prices` included. Click `Continue`. Home shows `1.79999000 BTC` and `3 tracked`.
- **Close to hide and lock**: run `kill -USR2 <electronPid>` (the `electron process` PID in the doctor output). The recipe uses the signal because CDP key events reach the page, not the macOS menu, so `Cmd+W` from a script does nothing; in verify mode the signal calls the same `BrowserWindow.close()` that `Cmd+W` and the red close button call. The Electron PID stays alive, its on-screen window count (below) is `0`, and the page shows `Enter your PIN`.
- **Single instance**: start a second copy of the run's copied `Bitcoin Control Center.app/Contents/MacOS/Bitcoin Control Center` with `--user-data-dir=<userDataDir>` (`userData:` in launch's output) and `BCC_VERIFY_CONFIG` set to `verify-config.json` in the run's scratch folder, beside `user-data`. It exits with code `0` within 10 seconds. The first Electron PID is still alive, CDP still lists exactly one page target, and the on-screen window count is `1`: the first window came back.
- **Unlock**: type `246813` in `PIN, 6 digits`. Home shows `1.79999000 BTC` again.
- **Second view**: click link `Settings`. `Security` reads `Your PIN locks Control Center when you close it.` with `Change PIN`.
- **Stored proof**: `helpers/verify query --sql "SELECT length(pin_hash) AS pin_hash_len, failed_attempts FROM profiles"` into `stored.json`: one row, `pin_hash_len` above 0 and `failed_attempts` `0`.

## Gotchas

- Read the window count from macOS, not the page: a hidden Electron window still reports `document.visibilityState` `visible`. This needs no Accessibility permission:

  ```bash
  osascript -l JavaScript -e 'ObjC.import("CoreGraphics"); ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0))).filter(w => w.kCGWindowOwnerPID === <electronPid> && w.kCGWindowLayer === 0).length'
  ```

- Never start the app, or the second copy, without `--user-data-dir` and `BCC_VERIFY_CONFIG`: it would open `~/Library/Application Support/desktop`, the developer's own data.
- `seed` refuses until the PIN is set in the UI. Run it at `Your PIN is set`, before `Continue`.
- `helpers/verify smoke` drives the same steps in its checks 1 and 3, without evidence per recipe.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
