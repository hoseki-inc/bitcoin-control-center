# Add account chooser

A user opens Add Account and sees one tile for each way to add an account: each hardware wallet, Multisig, each exchange, Manually Sign, and Track. The Track tile opens a second choice between Bitcoin Holdings, Bitcoin ETF Holdings and xpub or Descriptor. Back to Accounts closes the chooser. This recipe changes no data.

## Sub-features

Proves: `tiles`, `back`, `track-types`

## How to get to it (user POV)

- Accounts in the navigation, then link `Add Account` in the page header.
- The dashed `Add account` card at the end of the account list.
- `/accounts/add` directly.
- `Add Account` on the last onboarding step, and `Connect Another Account` on a success screen.

This recipe drives the first entry point only.

## Driving it with the browser

Preconditions: the baseline.

- **Open Accounts**: click link `Accounts` in the navigation. The heading `Accounts` shows with the three seeded accounts.
- **Open the chooser**: click link `Add Account`. The URL becomes `/accounts/add` and the heading `Connect New Account` shows twelve tile links, in this order: `Trezor`, `COLDCARD`, `Ledger`, `Keystone`, `Bitkey`, `Multisig`, `Coinbase`, `Kraken`, `Robinhood`, `Strike`, `Manually Sign`, `Track Balance, ETF, or xpub`. Each tile is a link: the devices and exchanges go to `/accounts/verify/<name>` in lower case, Multisig to `/multisig/create`, Manually Sign to `/accounts/verify/advanced` and Track to `/accounts/verify/manual-type`.
- **Back**: click button `Back to Accounts`. The URL becomes `/accounts` and the account list shows.
- **Track types**: click link `Add Account` again, then the tile `Track Balance, ETF, or xpub`. The URL becomes `/accounts/verify/manual-type` and the heading `Track Balance, ETF, or xpub` offers three choices: `Bitcoin Holdings`, `Bitcoin ETF Holdings` and `xpub or Descriptor`.
- **Second view**: click `xpub or Descriptor`. The URL becomes `/accounts/verify/track` and the heading `Track an xpub or Descriptor` shows. Browser Back returns to the three choices.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS accounts FROM accounts"` into `stored.json`. It still counts the three seeded accounts, so the chooser saved nothing.

## Gotchas

- Each tile is a link named by its title alone. Some browser tools' trees still list the tiles unnamed, with their hidden logos inside; find a tile by its title text or its `href`.
- The chooser fades between screens. Wait for the new heading before reading or clicking.
- A click can miss when the layout has just shifted, for example when a hint, an error or the script type radios appear, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
