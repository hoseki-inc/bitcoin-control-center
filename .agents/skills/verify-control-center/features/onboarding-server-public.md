# Onboarding server step, public server

On desktop, the introduction has a sixth step that asks which Electrum server to use: Blockstream's public server or the user's own node. Keeping the public server without Tor saves nothing, so the app stays on the server it started with. This recipe saves the onboarding choice.

## Sub-features

Proves: `choose-server`, `public-continue`

The own-node path is in `onboarding-server-own-node.md`, on its own fresh run. `tor` is not claimed: Tor needs the Electron shell.

## How to get to it (user POV)

- Open the desktop app for the first time.

## Driving it with the browser

Preconditions: a run launched with `helpers/verify launch --fresh --desktop` and not seeded. Drive this recipe before any other on that run.

- **Reach the step**: go to `/`. The URL becomes `/home` and the dialog reads `Step 1 of 6`. Click `Continue` four times, waiting for each step to settle, to `Step 5 of 6`, `Choose your Electrum server`.
- **The choice**: radio `public` (`Blockstream’s public server`, `Works right away, with nothing to set up.`) is checked, radio `own` (`My own node`, `Umbrel, Start9, or another Electrum server you run.`) is not, and `Connect via Tor` is off, with `Hides your IP address from Blockstream.`
- **Switch**: click `My own node`. It is checked, and `Only your node sees your wallets. You’ll enter its address next.` replaces the Tor switch. Click `Blockstream’s public server`; it is checked again with Tor off.
- **Continue**: click `Continue`. `Step 6 of 6` reads `Start with one account`.
- **Stored proof**: `helpers/verify query --sql "SELECT key, value FROM settings"` and `helpers/verify query --sql "SELECT nickname, host, port, protocol, tor_enabled FROM desktop_connection_profiles"` into `stored.json`. There is no `electrum_host` and no `statement_tx_source`, and the only connection is `Current connection` on the run's fake.
- **Close**: click `Not Now`. Home shows its empty state with the public server notice above the header.

## Gotchas

- The run starts on the fake Electrum, but the step and its preview still name `electrum.blockstream.info`. Continuing with Tor off connects nothing, so no request leaves the computer.
- Never turn on `Connect via Tor` here. It would try to start Tor, which needs the Electron shell.
- The dialog fades between steps. Read the step number after a second or two; text read too early belongs to the previous step.
- The previews show sample addresses and numbers. They are not the run's data.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
