# Onboarding server step, own node

On desktop, a user who picks their own node in the introduction enters its address, port and protocol, and Control Center connects before moving on. Missing or bad details, and a node that doesn't answer, keep them on the step with the reason. Once connected, the node is saved as `My node` and statements look up transactions on it. This recipe connects the run's fake Electrum and saves the onboarding choice.

## Sub-features

Proves: `own-node-form`, `own-node-validation`, `own-node-connect-failed`, `own-node-connected`

The public server path is in `onboarding-server-public.md`. `tor` is not claimed: Tor needs the Electron shell. `onboarding-server-tor.md` covers it in the packaged app.

## How to get to it (user POV)

- Open the desktop app for the first time, then choose `My own node`.

## Driving it with the browser

Preconditions: a run launched with `helpers/verify launch --fresh --desktop` and not seeded. Drive this recipe before any other on that run. `<port>` is the Electrum port from the doctor's `ports` check.

- **Reach the form**: go to `/`, click `Continue` four times, waiting for each step to settle, to `Step 5 of 6`. Click `My own node`, then `Continue`. `Connect your node` shows `Address` (placeholder `umbrel.local or 192.168.1.20`), `Port` `50002`, `Protocol` `SSL`, and `Connect via Tor` off, with buttons `Back`, `Skip` and `Connect`.
- **No address**: click `Connect`. `Enter your node’s address.`
- **Bad port**: Address `127.0.0.1`, Port `70000`, click `Connect`. `Enter a port from 1 to 65535.`
- **Onion without Tor**: Address `verifyexampleaddress.onion`, Port `50001`. The hint `Onion addresses need Tor. Turn on Connect via Tor.` shows. Click `Connect`: the dialog `Turn on Tor to connect` opens with `Tor must be on to connect to an onion address.`, and the step stays on `Connect your node`. Click `OK` to close it.
- **Connection fails**: Address `127.0.0.1`, Port `1`, Protocol `TCP`, click `Connect`. `Couldn’t connect to 127.0.0.1:1. Check these details and that your node is on.` shows with `connect ECONNREFUSED 127.0.0.1:1` beneath, still on step 5.
- **Stored proof, failed**: `helpers/verify query --sql "SELECT key, value FROM settings"` and `helpers/verify query --sql "SELECT nickname, host, port, protocol, tor_enabled FROM desktop_connection_profiles"` into `stored.json`: no `electrum_host`, and the only connection is `Current connection`.
- **Connect**: set Port `<port>` and click `Connect`. Toast `Connected to your node`, and the dialog moves to `Step 6 of 6`, `Start with one account`.
- **Stored proof, connected**: the same two queries, under their own key: `My node` on `127.0.0.1:<port>` `tcp` is the active connection, and `statement_tx_source` is `electrum`. The doctor still passes.
- **Second view**: click `Not Now` and go to `/settings`. No public server notice. Under `Statement data`, `Configured Electrum server` is checked, and `Saved connections` reads `2 of 5` with `My node` `Connected`.

## Gotchas

- Only connect to the run's fake. Any other reachable host is a real outside server; port `1` on `127.0.0.1` is closed.
- The onion address is checked in the page and never looked up. Never turn on `Connect via Tor`: it needs the Electron shell (`onboarding-server-tor.md`).
- The dialog fades between steps. Read the step number after a second or two.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
