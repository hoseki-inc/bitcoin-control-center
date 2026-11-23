# Onboarding server step with Tor

On a fresh packaged macOS Electron run, the onboarding server step exposes `Connect via Tor`, starts the bundled Tor daemon inside the isolated scratch folder when toggled on, and enforces that `.onion` addresses require Tor.

## Sub-features

Proves: `tor`

## How to get to it (user POV)

- First run on a fresh packaged desktop app (`helpers/verify launch --electron --fresh`), stepping through onboarding to the Electrum server step.

## Driving it with CDP (`helpers/verify launch --electron --fresh`)

Preconditions: a macOS run launched with `helpers/verify launch --electron --fresh`, unlocked with `246813`.

- **Reach server step**: step through the onboarding introduction to the server choice screen (`Blockstream's public server` / `My own node`), then select `My own node`.
- **Onion guard**: enter a `.onion` host with `Connect via Tor` off and verify the inline validation `Onion addresses need Tor` keeps `Connect` disabled.
- **Start bundled Tor**: toggle `Connect via Tor` on. Verify the UI shows `Starting Tor…` progress, `<userDataDir>/tor-data` is created in the run folder, and `portalProve.settings.electrumStatus` reports `tor.socksReady === true` and `tor.state === 'ready'` (or classify an offline timeout explicitly as `unreachable` with reason `Tor network blocked`).
- **Finish against fake Electrum**: turn `Connect via Tor` off, enter `127.0.0.1`, the run's fake Electrum port, and `TCP`, and click `Connect`. Verify `Connected to your node` and that `helpers/verify doctor` passes.

## Gotchas

- Never connect to `Blockstream's public server` or a real `.onion` node during verification; toggle Tor off before connecting to the local fake Electrum server.
- Because this needs the onboarding flow, launch with `--fresh` and do not seed the run.
