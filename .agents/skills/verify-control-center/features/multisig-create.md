# Multisig create

A user adds a multisig wallet by pasting its descriptor. Control Center checks it, says how many keys it needs, asks for a name, and opens the setup hub where the user picks a signing device. Adding the same descriptor again reuses the account, an archived one points to Archived, and Abandon removes an unfinished setup. This recipe adds a pending multisig account and abandons it, so the run ends as it started.

## Sub-features

Proves: `intro`, `paste`, `invalid`, `detected`, `name-validation`, `hub`, `abandon`, `already-exists`, `archived`

`upload` is not claimed: the browser tool can't attach a file.

## How to get to it (user POV)

- Add Account, then the `Multisig` tile.
- `/multisig/create` directly.

This recipe drives both.

## Driving it with the browser

Preconditions: the baseline. The descriptor is the public 2-of-3 `multisigNativeSegwitAccount` from `packages/testing/wallets.ts`: `wsh(sortedmulti(2,[98950b2a/48h/0h/0h/2h]xpub6FF4wJMrZjWwm8PpJhJJcD3uircG7QKMaijiZhiFmBoaNX2MJiyqZmQ1aYAu59VawDppV25P7PVwtFsnynPjMFq8DNwo1sPyNdher6jFEug/<0;1>/*,[1d25c06f/48h/0h/0h/2h]xpub6DfQuReLSBLxpNjNJsTFDKsA3FpoiRVuymrkmKYG7j7sFxdJdnC3DWZg9bahkxQoNqzq6CmYDZPeQhgpL63sBhMFZPvH2CuR6mnaaSiseNJ/<0;1>/*,[1d177351/48h/0h/0h/2h]xpub6F5dv5ncJreUTNJ89xwAfuzLGJ17CfuQeo9jPwQ5CLqyGoAnkN6QZMWtoMi73MREyJbWh4o521Ye3DFuRDhkigf8ocJtW4DadaSszNieAgr/<0;1>/*))#asdthwfj`.

- **Intro**: on `/accounts/add`, click the `Multisig` tile. The URL is `/multisig/create` with `Connect Your Multisig Wallet`, link `Back` to `/accounts` and button `Next`.
- **Upload step**: click `Next`. `Upload Your Multisig Descriptor` shows a drop zone and the toggle `Paste Your Multisig Descriptor`. Open the toggle.
- **Invalid**: type `not-a-descriptor`. `Invalid descriptor: Empty multi script type` shows and `Verify Descriptor` is disabled.
- **Paste**: replace it with the descriptor and click `Verify Descriptor`. `We've detected a 2 of 3 Multisig Wallet` shows with an empty `Name` (placeholder `Multisig claim name`) and `Next` disabled.
- **Name validation**: an empty name keeps `Next` disabled. 255 characters enable it; 256 show `Name exceeds limit of 255 characters` and disable it.
- **Hub**: name it `Verify Multisig` and click `Next`. The URL becomes `/multisig/<id>` with `Verify Multisig`, `2 of 3 multisig wallet`, three key badges (the first `Pending`), `Select a Signing Device` with `Trezor`, `Ledger`, `COLDCARD` and `Keystone`, and `You only need to sign with 2 of your 3 keys to complete verification.`
- **Already exists**: go through `/multisig/create` again with the same descriptor and the name `Verify Multisig Again`. The same `/multisig/<id>` opens, now named `Verify Multisig Again`.
- **Stored proof, reuse**: `helpers/verify query --sql "SELECT id, display_name, status, deleted_at FROM accounts ORDER BY created_at"` into `stored.json`: the three seeded accounts and one `pending` multisig.
- **Archived**: click `Archive Account`, then the dialog's `Archive`. Go through `/multisig/create` once more with the same descriptor. Toast `This account is archived` / `Restore it from Archived accounts before reconnecting.`; the URL is `/accounts#archived` with the account listed.
- **Abandon**: click `Restore`, open the pending card (it links to `/multisig/<id>`) and click `Abandon`. The dialog `Abandon Account Setup?` says it removes the account and its captured history and cannot be undone. Click its `Abandon`. Toast `'Verify Multisig Again' setup abandoned`; the URL is `/accounts` and the totals are the baseline.
- **Stored proof, abandoned**: run the same query and add it to `stored.json` under its own key: only the three seeded accounts.

## Gotchas

- Adding an existing pending descriptor renames the account to the new name; the track flow keeps the old name instead.
- The paste panel can be collapsed when the upload step is re-entered. Open it before pasting; form_input fills the hidden box otherwise.
- The URL carries a `keystoreId` query that the browser tool may show as `REDACTED`.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
