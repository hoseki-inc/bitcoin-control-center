# Public server notice

On desktop, while Electrum is still on the server the app started with, a strip above the header suggests connecting your own node. Its link opens Electrum settings, and connecting another server hides the strip for good. This recipe adds and connects a saved connection to the run's fake Electrum, so later recipes in the run see it.

## Sub-features

Proves: `public-server`, `public-hidden-on-own-node`

`public-dismiss` is in `notices-dismiss.md`: once a server is connected the strip never shows again, so it needs its own run.

## How to get to it (user POV)

- Any page, while no connection has been connected.

## Driving it with the browser

Preconditions: a run launched with `--desktop`, before any recipe connects an Electrum connection. Seeding doesn't matter. The run's starting server is the fake, but the app treats any server it started with as the public one.

- **See the notice**: go to `/home`. Above the header: `Want more privacy? Look up your wallets on your own node.` with link `Connect your node` and button `Dismiss`.
- **Stored proof, before**: `helpers/verify query --sql "SELECT key, value FROM settings WHERE key IN ('electrum_host','electrum_port','electrum_notice_v1')"` returns no rows.
- **Follow the link**: click `Connect your node`. The URL is `/settings#electrum-server`, scrolled to `Electrum Server`, with `Saved connections` `1 of 5` and `Current connection` `Connected · 127.0.0.1:<Electrum port> (TCP)`.
- **Connect another server**: click `New connection`. Name `Verify Fake`, `Start with` `My own server`, Host `127.0.0.1`, Port the Electrum port from the doctor's `ports` check, Protocol `TCP`, `Connect via Tor` off. Click `Save & Connect`. Toast `Connection saved`; the list reads `2 of 5` with `Verify Fake` `Connected`, and the strip is gone.
- **Stored proof, after**: the same query returns `electrum_host` `127.0.0.1` and `electrum_port` the Electrum port. The doctor still passes.
- **Stays hidden**: go to `/home`. The page starts with the header; no strip.

## Gotchas

- Only connect to the run's fake. `Blockstream (Public)` and any other host is a real outside server.
- The new-connection form starts on `SSL` and port `50002`. Set the port and `TCP`.
- A click can miss while the page fades in after loading. Check the result after every click.
- A screenshot can show the frame before the last action, or a chart still drawing. Wait a second before capturing, and trust the page's text over the picture.
