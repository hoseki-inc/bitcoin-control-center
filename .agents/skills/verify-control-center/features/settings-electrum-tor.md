# Settings Electrum Tor

In the packaged macOS Electron app, turning `Connect via Tor` on for a connection in Settings starts the bundled Tor inside the run's own data folder and shows its progress until `Tor ready`. An onion address can't turn Tor off, and a new connection that had Tor on asks before connecting without it. This recipe saves nothing: the active connection stays the run's fake Electrum.

## Sub-features

Proves: `tor`

`tor-failed` is not claimed: no helper makes Tor fail on demand, so the red switch and its message stay unproved.

## How to get to it (user POV)

- Settings, the `Electrum Server` section, `New connection` (or a saved connection), `Connect via Tor`.
- `/settings` directly.

This recipe drives `New connection` from `/settings`.

## Driving it with CDP (`helpers/verify launch --electron`)

Preconditions: a seeded macOS run launched with `helpers/verify launch --electron` (or the run `desktop-shell` left), unlocked with `246813`. Bundled Tor reaches the public Tor network to start; nothing else leaves `127.0.0.1`.

- **Open the form**: go to `/settings` and click `New connection`. The switch `Connect via Tor` is off, and its label element `label.chakra-switch` has `data-tor="off"`.
- **Start bundled Tor**: click the switch's label `Connect via Tor`. The visible label and the hidden checkbox are joined by `for`: find the checkbox by its label `Connect via Tor`, then click its `label.chakra-switch` parent. The switch turns on and `Starting Tor… <n>%` shows with a progress bar; after 30 seconds the line adds `. This can take up to two minutes.` Within two minutes it reads `Tor ready` and `data-tor` is `ready`. The status line sits below the switch: scroll it into view before each screenshot so the picture shows it. The run's `<userDataDir>/tor-data` folder now exists.
- **Onion keeps Tor on**: type `example.onion` in `Host`, then click the switch's label. The dialog `This connection needs Tor` shows with `Keep Tor on`. Click `Keep Tor on`: the switch is still on.
- **Leaving Tor asks first**: replace `Host` with `127.0.0.1`, set `Port` to the run's fake Electrum port and `Protocol` to `TCP`, then click the switch's label to turn Tor off. Click `Test Connection`. The dialog `Connect without Tor?` says `The server will be able to see your IP address.` Click `Cancel`: the dialog closes and no test result shows.
- **Stored proof**: `helpers/verify query --sql "SELECT id, nickname, host, port, protocol, tor_enabled FROM desktop_connection_profiles"` and `helpers/verify query --sql "SELECT key, value FROM settings WHERE key = 'desktop_active_connection'"` into `stored.json`: no row has `tor_enabled` 1, and `desktop_active_connection` holds the `id` of the row on `127.0.0.1` at the run's fake Electrum port. `helpers/verify doctor` passes.

## Gotchas

- Never save or connect a Tor connection to `127.0.0.1`: Tor can't reach loopback addresses.
- Tor may already be running when another recipe on this run started it. Then `Starting Tor…` can be skipped and `Tor ready` shows at once.
- `Tor ready` fades after a few seconds. Poll for it every quarter second, capture it as soon as it shows, and keep the ARIA snapshot of the same moment as proof of its text.
- `data-tor` sits on the switch's label element, not on the `#connection-tor` checkbox.
- On a network that blocks Tor, the start fails. Record the recipe `unreachable` with reason `Tor network blocked`, never `verified`.
- `helpers/verify smoke` starts Tor in its check 5 but does not drive the dialogs.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
