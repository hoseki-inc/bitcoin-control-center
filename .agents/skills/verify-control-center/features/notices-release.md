# Release update notice

In the packaged macOS Electron app, when the configured release-check endpoint serves a version newer than the packaged `bccReleaseVersion`, a release notice pill with a `Download` link appears fixed at the bottom of the window; dismissing it hides it for the current session without making any external network requests.

## Sub-features

Proves: `release`, `release-dismiss`

## How to get to it (user POV)

- Any page in the packaged desktop app when a newer release tag is published.

## Driving it with CDP (`helpers/verify launch --electron --release-tag v99.0.0_0`)

Preconditions: a macOS run launched with `helpers/verify launch --electron --release-tag v99.0.0_0` (seeded or fresh). Launch points Sentinel's `ReleaseCheckService` at the local fake `http://127.0.0.1:<mempoolPort>/latest.json` serving `{ "tag": "v99.0.0_0" }`, so no request ever leaves loopback.

- **See the notice**: unlock with `246813` and open `/home`. Fixed at the bottom of the window, confirm the update notice appears (`Bitcoin Control Center 99.0.0 is available.`) with a `Download` link and a `Dismiss` button. Capture screenshot.
- **Check Download link without loading it**: read the `Download` link's `href` (do not open the external site) and verify it is `https://www.bitcoincontrolcenter.com/#downloads`.
- **Dismiss**: click `Dismiss` (`button[aria-label="Dismiss"]`). Verify the release notice disappears and stays hidden across in-app navigation (e.g., `/settings` and back to `/home`).
- **Stored / log proof**: confirm `fake-requests.log` contains a `mempool GET /latest.json 200` line (proving the release check actually ran against the fake), and check `helpers/verify doctor` passes with zero `UNHANDLED` or `ERROR` lines in `fake-requests.log`.

## Gotchas

- Never click `Download` in automated runs unless intercepting external navigation; checking `href` verifies the target without leaving loopback.
- Passing `--release-tag` requires `--electron`. Without `--release-tag`, `--electron` disables release checks so routine runs stay completely silent and deterministic.
