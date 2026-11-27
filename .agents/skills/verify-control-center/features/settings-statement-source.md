# Settings statement source

On desktop, a user picks where statements look up their transactions: mempool.space or the configured Electrum server. The choice saves at once, and a help line says who sees the lookups. This recipe switches to Electrum and back, so the run ends as it started.

## Sub-features

Proves: `choose`, `privacy-help`

`tor-note` is not claimed: it shows only while the active connection goes through Tor, and no verify run can connect through Tor, because Tor can't reach the run's fake Electrum on `127.0.0.1`. `settings-electrum-tor.md` starts Tor in the packaged app but never connects through it.

## How to get to it (user POV)

- The settings (gear) button in the header.
- `/settings` directly.

This recipe drives the second entry point.

## Driving it with the browser

Preconditions: a run launched with `--desktop`. Seeding doesn't matter. In a run without `--desktop` the section is missing.

- **Open Settings**: go to `/settings`. Under heading `Statement data`, radio `mempool` (`mempool.space`, `Fastest · Default`) is checked and the help line reads `Fastest. Your IP address and transaction details are shared with mempool.space.`
- **Choose Electrum**: click radio `electrum` (`Configured Electrum server`, `Slower`). It is checked and the help line reads `Slower. Your IP address and transaction details are shared with the server operator.`
- **Stored proof**: `helpers/verify query --sql "SELECT key, value FROM settings WHERE key = 'statement_tx_source'"` into `stored.json`: `electrum`.
- **Reload**: reload `/settings`. Radio `electrum` is still checked. The saved choice loads after the section draws, so wait for the radio to become checked rather than reading it once the heading shows.
- **Back to mempool.space**: click radio `mempool`. Status `Statement source saved` shows, the help line is the mempool.space one again, and the same query reads `mempool`. Add it to `stored.json` under its own key.

## Gotchas

- The `mempool.space` label is the source's name. Statement lookups still go to the run's fake mempool server.
- A click can miss while the page fades in after loading. Check the radio after every click, and click again if it didn't change.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
