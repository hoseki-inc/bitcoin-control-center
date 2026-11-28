# Ledger

A user connects a Ledger, picks one of the Bitcoin accounts it finds, and proves control by signing a message on the device. Rejecting on the device shows the rejection and leaves the account pending, and signing again verifies it. A Ledger with no funded accounts finds none. This recipe drives the run's emulated Ledger on a Flex, then one signing on a Nano S Plus.

## Sub-features

Proves: `connect`, `no-wallets`, `sign`, `user-reject`

`disconnect` is not claimed: it needs `emulator disconnect`, which comes in a later change.

## How to get to it (user POV)

- Accounts, link `Add Account`, tile `Ledger`.
- `/accounts/verify/ledger` directly.
- A pending Ledger account's `/accounts/<id>/signing`, to sign again.

This recipe drives the first entry point, and comes back to signing through `Retry`.

## Driving it with the browser

Preconditions: a run launched with `helpers/verify launch --emulator ledger --ledger-model flex`, seeded, doctor passing. Open the app at the `open:` URL launch printed (the bridge's drive URL), never the Sentinel URL: only the drive URL reaches the Ledger. The emulator uses the public `primary` seed, which the fake chain funds on m/84' (0.2 BTC), m/49' (0.15 BTC) and m/44' (0.05 BTC).

Steps:

- **Intro**: Accounts, link `Add Account`, tile `Ledger`. The heading `Verifying Ownership With Your Ledger` shows `Back` and `Next`.
- **Connect**: click `Next`. `Scan complete!` lists three cards named `Bitcoin 1`, with `0.05000000 BTC`, `0.20000000 BTC` and `0.15000000 BTC`, each with a `Select Bitcoin 1` button. Click `Select Bitcoin 1` inside the `0.20000000 BTC` card. `Continue verification with the selected account?` shows `No, Cancel` and `Yes, Continue`. Click `Yes, Continue`. The URL becomes `/accounts/<id>/signing`; note `<id>`.
- **Pending claim**: `helpers/verify query --sql "SELECT a.id, a.status, k.wallet, k.derivation_path FROM accounts a JOIN keystores k ON k.account_id = a.id WHERE k.wallet = 'ledger'"` into `stored-connect.json`: one row, `<id>`, `pending`, `ledger`, `m/84h/0h/0h`.
- **Prove Control**: click `Next`, then `Next`. `Proving Control With Your Ledger` shows the message, address `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu` and path `m/84'/0'/0'/0/0`. Click `Prove Control`. `helpers/verify emulator status --device ledger` shows the Flex on `Review message` and the bridge with an APDU waiting.
- **User reject**: `helpers/verify emulator reject --device ledger`. The page shows the alert `The user rejected the the action on the device.` and `Retry`. The account is still `pending` and has no signature: `SELECT a.status, (SELECT count(*) FROM signed_messages s JOIN keystores k ON k.id = s.keystore_id WHERE k.account_id = a.id AND s.signature IS NOT NULL) AS signatures FROM accounts a WHERE a.id = '<id>'` into `stored-rejected.json`: `pending`, `0`.
- **Sign**: click `Retry`. The page reloads on `/accounts/<id>/signing`. Click `Next`, `Next`, `Prove Control`, then run `helpers/verify emulator press --device ledger`. The URL becomes `/accounts/verify/receipt/<id>`, headed `Ledger Verified!`, with `0.20000000` BTC, `verified`, `Generate Statement` and `View Ledger`.
- **Stored proof**: `SELECT a.status, s.address, length(s.signature) AS signature_length, c.is_satisfied FROM accounts a JOIN keystores k ON k.account_id = a.id JOIN signed_messages s ON s.keystore_id = k.id JOIN challenges c ON c.id = s.challenge_id WHERE a.id = '<id>' AND s.signature IS NOT NULL` into `stored-verified.json`: `verified`, the address above, `88`, `1`.
- **Second view**: click `View Ledger`. Account Details for `Bitcoin Native Segwit 1` shows `0.20000000 BTC`, Status `verified` and Script Type `Native SegWit (P2WPKH)`.
- **No wallets**: `helpers/verify emulator stop --device ledger`, then `helpers/verify emulator start --device ledger --seed empty --bridge`. Open `/accounts/verify/ledger` on the new drive URL it printed and click `Next`. The page shows `No wallets found` and `Back`. Still one Ledger account in the database.
- **Nano S Plus**: `emulator stop`, then `emulator start --device ledger --model nanosp --bridge`. On the new drive URL, Ledger, `Next`, `Select Bitcoin 1` inside the `0.15000000 BTC` card, `Yes, Continue`, `Next`, `Next`, `Prove Control`, then `emulator press`. It pages through the message on the device and confirms `Sign message`. The receipt shows `Ledger Verified!` and `0.15000000` BTC; the database has a second verified Ledger account on `m/49h/0h/0h`.

## Gotchas

- Every `emulator start` gets a new bridge with a new drive URL, in manual mode unless it asks for `--auto-approve`. Open the app at the URL that start printed; the old one no longer answers.
- `press` and `reject` act on the prompt on the device, so click `Prove Control` first and run them while the page says it is waiting for the device. With no prompt they fail after 5 seconds instead of waiting.
- `evidence begin` records the Ledger running at that moment. Steps that restart the device with another seed or model belong in the trace.
- The three accounts share the name `Bitcoin 1`. Pick by the balance in the card, never by position.
- `Retry` reloads the page. Find every button again after it.
