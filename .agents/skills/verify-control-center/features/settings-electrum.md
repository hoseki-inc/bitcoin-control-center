# Settings Electrum connections

On desktop, a user keeps up to five saved Electrum connections. They test one, save one without connecting, save and connect, rename and delete them. Settings refuses a bad host, won't delete the server it is connected to, asks before dropping unsaved edits, and stops at five. This recipe leaves five saved connections, with `Verify Fake 2` connected to the run's fake Electrum.

## Sub-features

Proves: `list`, `new-and-save`, `save-and-connect`, `test`, `rename`, `delete`, `limit`, `unsaved-changes`, `invalid`

`tor` is not claimed: Tor needs the Electron shell.

## How to get to it (user POV)

- Settings, the `Electrum Server` section.
- The public server notice's `Connect your node` link (`notices-public-server.md`).

This recipe goes to `/settings#electrum-server` directly.

## Driving it with the browser

Preconditions: a run launched with `--desktop`, after `notices-public-server.md`, which saves and connects `Verify Fake`. `<port>` below is the Electrum port from the doctor's `ports` check.

- **List**: `Saved connections` reads `2 of 5`: `Current connection` `Direct` and `Verify Fake` `Connected`. The details read `Verify Fake`, `Connected · 127.0.0.1:<port> (TCP)`.
- **Test**: click `Test Connection`. `Connection successful` shows above the buttons.
- **Out-of-range port**: click `New connection`. Name `Verify Down`, Host `bad host!`, Port `70000`, Protocol `TCP`. `Test Connection`, `Save` and `Save & Connect` are all disabled, with no message.
- **Invalid host**: set Port `1` and click `Save`. A toast and an inline message read `Invalid Electrum host`, and the list still reads `2 of 5`.
- **Test failure**: set Host `127.0.0.1` and click `Test Connection`. It shows `connect ECONNREFUSED 127.0.0.1:1`.
- **Save without connecting**: click `Save`. Toast `Connection saved. Select Connect when you want to use it.` The list reads `3 of 5`, `Verify Down` is `Not connected` with a `Connect` button, and `Verify Fake` stays `Connected`.
- **Unsaved changes**: change Port to `2`, then click `Verify Fake` in the list. `You have unsaved changes. Discard them to continue?` shows with `Keep editing` and `Discard changes`. Click `Discard changes`; `Verify Fake` opens.
- **Active can't be deleted**: click `Delete Verify Fake`. The dialog `Delete “Verify Fake”?` says `You’re connected to this server. Connect to another saved connection before deleting this one.` and `Delete connection` is disabled. Click `Cancel`.
- **Rename**: open `Verify Down`, click `Rename Verify Down`, type `Verify Closed Port` and click `Save connection name`. Toast `Connection renamed`. Its Port still reads `1`, so the discarded edit was never saved.
- **Limit**: save `Verify Extra 1` (`127.0.0.1`, port `2`, `TCP`) and `Verify Extra 2` (port `3`) with `Save`. The list reads `5 of 5`, and `New connection` is disabled with `Limit reached. Delete one to add another.`
- **Stored proof, at the limit**: `helpers/verify query --sql "SELECT nickname, host, port, protocol, tor_enabled FROM desktop_connection_profiles"` into `stored.json`: five rows, `Verify Closed Port` on port `1`.
- **Delete**: click `Delete Verify Extra 2`. The dialog says `This removes the saved connection. Your accounts and wallet data are kept.` Click `Delete connection`. Toast `Connection deleted`; the list reads `4 of 5`.
- **Save and connect**: click `New connection`. Name `Verify Fake 2`, Host `127.0.0.1`, Port `<port>`, `TCP`, and click `Save & Connect`. Toast `Connection saved`; `Verify Fake 2` is `Connected`, `Verify Fake` is `Direct`, and the list reads `5 of 5`.
- **Stored proof, after**: add the same query to `stored.json`, plus `SELECT nickname FROM desktop_connection_profiles WHERE id = (SELECT value FROM settings WHERE key='desktop_active_connection')`, which returns `Verify Fake 2`. The doctor still passes.

## Gotchas

- Only connect to the run's fake. `Blockstream (Public)` and any other reachable host is a real outside server. Ports 1 to 3 on `127.0.0.1` are closed, so saving them is safe; never connect to them.
- The new-connection form starts on `SSL` and port `50002`. Set the port and `TCP`.
- While a saved connection has unsaved edits, its buttons are `Test Connection` and `Save & Connect`.
- `read_page`'s interactive filter can miss the form's buttons. Use `find` with the button's name.
- A click can miss while the page fades in after loading. Check the result after every click.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
