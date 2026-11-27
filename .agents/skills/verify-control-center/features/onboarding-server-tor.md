# Onboarding server step with Tor

On a fresh packaged macOS Electron run, the onboarding server step exposes `Connect via Tor`, starts the bundled Tor daemon inside the isolated scratch folder when toggled on, and stops a Connect press on a `.onion` address with Tor off with a dialog that asks for Tor, without starting Tor or connecting.

## Sub-features

Proves: `tor`

## How to get to it (user POV)

- First run on a fresh packaged desktop app (`helpers/verify launch --electron --fresh`), stepping through onboarding to the Electrum server step.

## Driving it with CDP (`helpers/verify launch --electron --fresh`)

Preconditions: a macOS run launched with `helpers/verify launch --electron --fresh`, unlocked with `246813`.

- **Unlock**: the window may be asking for the PIN or may already be unlocked. Wait until either the `PIN, 6 digits` field or `Step 1 of 6` shows. If the field shows, enter `246813`, then wait for `Step 1 of 6`.

- **Reach server step**: step through the onboarding introduction to the server choice screen (`Blockstream's public server` / `My own node`), then select `My own node`.
- **Onion hint**: enter `example.onion` in `Address` with `Connect via Tor` off. The hint `Onion addresses need Tor. Turn on Connect via Tor.` shows under the switch, and `Connect` stays enabled.
- **Onion dialog**: click `Connect`. A dialog named `Turn on Tor to connect` opens with `Tor must be on to connect to an onion address.` The step stays on `Connect your node`, no `Starting Tor…` appears, and no error alert shows. Click `OK`; the dialog closes and the address is unchanged.
- **Start bundled Tor**: toggle `Connect via Tor` on. The switch is checked, its line reads `Hides your IP address. Tor can take a minute to start.`, and the preview's `Your IP address` reads `Hidden by Tor`. Onboarding shows no Tor progress of its own (that is Settings, `settings-electrum-tor.md`). Prove the start in the background: the run's `logs/electron.log` has its first `portalProve.settings.startTor` request only now, after the dialog closed; `<userDataDir>/tor-data` is created in the run folder; and within two minutes the read-only status query Settings polls, `portalProve.settings.electrumStatus` (sent from the page with its `x-bcc-tab` header), reports `socksReady` `true` and state `ready`. An offline timeout is `unreachable` with reason `Tor network blocked`.
- **Finish against fake Electrum**: turn `Connect via Tor` off, enter `127.0.0.1`, the run's fake Electrum port, and `TCP`, and click `Connect`. Verify `Connected to your node` and that `helpers/verify doctor` passes.

## Gotchas

- Reloading doesn't always ask for the PIN: a tab that is already unlocked stays unlocked. Wait for whichever comes first rather than assuming the PIN screen.
- Onboarding has no `Starting Tor…` line. Don't wait for one.
- The dialog comes from the Connect press, not from typing. Pressing Enter in `Address` connects the same way and opens the same dialog.
- Never connect to `Blockstream's public server` or a real `.onion` node during verification; toggle Tor off before connecting to the local fake Electrum server.
- Because this needs the onboarding flow, launch with `--fresh` and do not seed the run.
