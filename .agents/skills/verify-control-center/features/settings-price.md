# Settings price

A user picks where Control Center gets the Bitcoin price and whether it may fall back to the next source when that one is down. Each change saves at once, with no Save button, and stays after a reload.

## Sub-features

Proves: `section`, `toggle-fallbacks`, `persists`

Run `helpers/verify evidence begin settings-price` before driving it and `helpers/verify evidence record settings-price --status <status>` after.

## How to get to it (user POV)

- The settings (gear) button in the header.
- `/settings` directly.

This recipe drives the second entry point. It turns fallbacks on and back off, so the run ends as it started.

## Driving it with the browser

Preconditions: a launched run whose doctor passes `prices` (source mempool, fallbacks off). Seeding doesn't matter.

- **Open Settings**: go to `/settings`. Wait for the heading `Bitcoin price`.
- **Read the section**: under `Bitcoin price`, combobox `Price source` shows `Your mempool server (127.0.0.1:<mempool port>)`, the port the doctor's `ports` check names. Its other options are `Block`, `mempool.space`, `Coinbase` and `CoinGecko`. Checkbox `Allow fallbacks` is unchecked.
- **Turn fallbacks on**: click checkbox `Allow fallbacks`. It becomes checked, and a green check shows beside `Price source`.
- **Stored proof**: `helpers/verify query --sql "SELECT key, value FROM settings WHERE key LIKE 'price%'"` into `stored.json`. `price_source` is `mempool` and `price_fallbacks_enabled` is `true`.
- **Reload**: reload the page and wait for `Bitcoin price`. `Allow fallbacks` is still checked and `Price source` is unchanged.
- **Turn fallbacks off**: click `Allow fallbacks` again. It becomes unchecked, the query shows `price_fallbacks_enabled` `false`, and the doctor's `prices` check passes again.

## Gotchas

- Don't change `Price source`. Every other source is a real outside service, so picking one sends requests to it and fails the doctor's `prices` check for the rest of the run.
- Leaving fallbacks on also fails the doctor's `prices` check. Always end with it off.
- A click right after the page loads can be lost. Find the checkbox by its label after the heading shows, and confirm it changed after every click.
