# Settings Electrum Tor

In the packaged macOS Electron app, turning `Connect via Tor` on in Settings starts the bundled `tor` binary inside the run's isolated `user-data/tor-data` directory, binds a local SOCKS listener, and bootstraps to 100% (`Tor ready`) without touching the developer's own data folder or switching the active fake Electrum connection.

## Sub-features

Proves: `tor`

## How to get to it (user POV)

- Settings, the `Electrum Server` section, `New connection` (or an existing saved connection), `Connect via Tor`.

## Driving it with CDP (`helpers/verify launch --electron` or `helpers/verify smoke`)

Preconditions: a macOS run launched with `helpers/verify launch --electron` (seeded or fresh), unlocked with `246813`.

- **Start bundled Tor**: open `/settings#electrum-server`, click `New connection`, and toggle `Connect via Tor` on without saving or connecting the new profile (so the active fake Electrum server stays undisturbed).
- **Progress and bootstrap**: observe `Starting Tor… <n>%` in the form. Poll `portalProve.settings.electrumStatus` until `tor.state === 'ready'` (up to 120 seconds) and verify `tor.socksReady === true` and `<userDataDir>/tor-data` was created inside the scratch run folder.
- **Onion validation**: type `example.onion` into `Host` and turn `Connect via Tor` off; confirm the modal `This connection needs Tor` appears with `Keep Tor on`, proving onion addresses cannot silently fall back to clearnet.
- **Clean state**: cancel/turn `Connect via Tor` off on the unsaved draft. Run `helpers/verify doctor` and verify the active Electrum connection is still the local fake.

## Gotchas

- Bundled Tor connects to the public Tor network during bootstrap; `helpers/verify smoke` defaults to `--tor-mode online` and fails if bootstrap does not reach 100%.
- In an air-gapped or Tor-blocked network, `helpers/verify smoke --tor-mode allow-offline` still fails on missing/unexecutable binaries, bad code signatures, or failure to bind the local SOCKS listener, and records post-SOCKS bootstrap timeouts explicitly as `offline-unverified` (never `pass`).
- Do not save or connect a Tor-enabled profile against `127.0.0.1`: Tor cannot route to loopback addresses.
