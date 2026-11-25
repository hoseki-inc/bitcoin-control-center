# Desktop shell

In the packaged macOS Electron app, the desktop PIN gate always runs first on a fresh profile, closing the window hides the app to the tray and locks the PIN instead of quitting, and launching a second instance against the same data folder exits cleanly and focuses the first window.

## Sub-features

Proves: `close-to-hide`, `single-instance`, `pin-first`

`tray` and `external-links` are not claimed: clicking native macOS menu-bar tray items and verifying macOS opens the system browser stay interactive/manual checks.

## How to get to it (user POV)

- Launch the packaged macOS app (`Bitcoin Control Center.app`) on a fresh isolated profile.

## Driving it with CDP (`helpers/verify launch --electron --setup-pin-in-ui` or `helpers/verify smoke`)

Preconditions: macOS run launched with `helpers/verify launch --electron --setup-pin-in-ui` (or run automatically inside `helpers/verify smoke`).

- **PIN first**: connect over CDP (`http://127.0.0.1:<cdpPort>`). There is exactly one page target, `window.desktop.platform === 'darwin'`, and the first screen is `Set up your PIN`. Enter `246813`, confirm `246813`, pause at `Your PIN is set`, disable price fallbacks, run `helpers/verify seed` and `helpers/verify doctor`, then click `Continue`. Home opens with `1.79999 BTC`.
- **Close to hide and lock**: close the BrowserWindow interactively with `Cmd+W` (or from a script in verify mode, send `kill -USR2 <electronPid>`, which calls `mainWindow.close()`). Verify the recorded Electron PID stays alive (the app hid to the tray instead of quitting) and the renderer immediately switches to `Enter your PIN`.
- **Single instance**: launch a second copy of the run's copied `Bitcoin Control Center.app/Contents/MacOS/Bitcoin Control Center` with the same `--user-data-dir` and `BCC_VERIFY_CONFIG`. Verify it exits with code `0` within 10 seconds, the primary Electron process stays alive, and CDP still reports exactly one page target.
- **Unlock after re-focus**: enter `246813` on `Enter your PIN` and verify Home (`1.79999 BTC`) reappears.
- **Stored proof**: `helpers/verify query --sql "SELECT id, length(pin_hash) AS pin_hash_len FROM profiles"` into `stored.json` shows `pin_hash_len > 0`.

## Gotchas

- Never launch without `--user-data-dir` and `BCC_VERIFY_CONFIG`: doing so would attach to or open `~/Library/Application Support/desktop`.
- `helpers/verify smoke` exercises all three sub-features automatically in Checks 1 and 3 and verifies clean `SIGTERM` shutdown with zero survivors in Check 8.
