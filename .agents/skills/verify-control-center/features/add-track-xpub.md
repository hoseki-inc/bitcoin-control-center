# Track an xpub or descriptor

A user tracks a wallet's balance without proving they own it. They name it and paste an xpub or a descriptor. The form says what it parsed, asks for a script type when a plain xpub doesn't carry one, and refuses text that is neither. Track Wallet adds the account as Unverified and opens it. Tracking a wallet that is already in Control Center opens that account instead, and tracking one whose verification stopped partway turns it Unverified. This recipe adds two accounts.

## Sub-features

Proves: `track-new`, `parsed-hint`, `plain-xpub-script-type`, `invalid-input`, `track-existing`, `pending-to-tracked`

`private-key-refused` is not claimed: the form shows the generic invalid message for an `xprv`, so Sentinel's private-key message never reaches the screen.

## How to get to it (user POV)

- Add Account, then `Track Balance, ETF, or xpub`, then `xpub or Descriptor`.
- `/accounts/verify/track` directly.

This recipe drives the first entry point. It also uses Manually Sign once, to make a pending account.

## Driving it with the browser

Preconditions: the baseline. All keys below are public test keys from `packages/testing/wallets.ts`.

- **Open the form**: Accounts, link `Add Account`, tile `Track Balance, ETF, or xpub`, then `xpub or Descriptor`. The URL is `/accounts/verify/track`; button `Track Wallet` is disabled.
- **Invalid input**: type `Verify Track Legacy` in `Display Name` and `not-a-key` in `xpub or Descriptor`. The message `Enter an xpub, or a single-sig or multisig descriptor` shows and `Track Wallet` stays disabled.
- **Multisig hint**: replace the key with `wsh(sortedmulti(2,[98950b2a/48h/0h/0h/2h]xpub6FF4wJMrZjWwm8PpJhJJcD3uircG7QKMaijiZhiFmBoaNX2MJiyqZmQ1aYAu59VawDppV25P7PVwtFsnynPjMFq8DNwo1sPyNdher6jFEug/<0;1>/*,[1d25c06f/48h/0h/0h/2h]xpub6DfQuReLSBLxpNjNJsTFDKsA3FpoiRVuymrkmKYG7j7sFxdJdnC3DWZg9bahkxQoNqzq6CmYDZPeQhgpL63sBhMFZPvH2CuR6mnaaSiseNJ/<0;1>/*,[1d177351/48h/0h/0h/2h]xpub6F5dv5ncJreUTNJ89xwAfuzLGJ17CfuQeo9jPwQ5CLqyGoAnkN6QZMWtoMi73MREyJbWh4o521Ye3DFuRDhkigf8ocJtW4DadaSszNieAgr/<0;1>/*))#asdthwfj`. The hint `Multisig, 2 of 3` shows and `Track Wallet` is enabled.
- **Plain xpub**: replace the key with `xpub6BqN8FZQhMmbuUehywWNTkRjMAYpTNhqvu6fMiYx4dw9Bagf8218mXwD8QGMswfcAAiqxfUoiHiGcV1iE3oDG9rFBoyDBw1a6FJAFVQhc1j`. A `Script Type` radio group appears with `Legacy (P2PKH)`, `Nested SegWit (P2SH)`, `Native SegWit (P2WPKH)` and `Taproot (P2TR)`; Legacy is checked and the hint reads `Single-sig, Legacy (P2PKH)`. Pick `Native SegWit (P2WPKH)`: the hint changes to match. Pick `Legacy (P2PKH)` again.
- **Track it**: click `Track Wallet`. Toast `Wallet added`; the URL becomes `/accounts/<id>` with the heading `Verify Track Legacy`, Amount `0.00000000 BTC`, Status `Unverified` and Script Type `Legacy (P2PKH)`.
- **Track an existing wallet**: open the form again. Type `Verify Duplicate` and `xpub6CpHLzJqtsCcXdxt9QkUbnzoVsQ4kueZWrmbkrXZPm8QdwvGj2s8YNsQkCQfZwVsgQRWdcSrfMjwC18wpHjaSGTPbvqT4Q5zk57XcfhkSQG`, pick `Native SegWit (P2WPKH)`, click `Track Wallet`. Toast `This wallet is already in Control Center`; the page is `Verify Watch Segwit`'s, still with that name and 1 BTC.
- **Make a pending account**: Add Account, tile `Manually Sign`. Type `Verify Pending Track` in `Display name` and `xpub6CQrPd5mpXz9HHdoKXJDjoGUhjBpfhvT63HEVKHr8C2cSeyX7wiKmLJCew6kDRg9rt8Pe7jAP5x3h9MW8cGCxYdEgEWQegv9knmqGSaeCoP` in `Account descriptor or extended public key`, pick `Nested SegWit (P2SH)`, click `Add Account`. The URL becomes `/accounts/<id>/signing`. Do not sign. Accounts shows `Verify Pending Track` with a `Pending` badge.
- **Track the pending wallet**: open the track form, type `Verify Pending Tracked` and the same `xpub6CQr…` key, pick `Nested SegWit (P2SH)`, click `Track Wallet`. Toast `This wallet is already in Control Center`; the page is `Verify Pending Track`'s, now with Status `Unverified`, Amount `0.10000000 BTC` and Script Type `Nested SegWit (P2SH)`.
- **Second view**: Accounts lists `Verify Track Legacy` and `Verify Pending Track` as Unverified, no Pending badge, and one `Verify Watch Segwit`.
- **Stored proof**: `helpers/verify query --sql "SELECT display_name, status, deleted_at FROM accounts ORDER BY created_at"` into `stored.json`. It has the three seeded accounts unchanged, then `Verify Track Legacy` and `Verify Pending Track`, both `unverified`, and no `Verify Duplicate` or `Verify Pending Tracked`.

## Gotchas

- An `xprv` gets the same invalid message as any other bad text; don't wait for the private-key message.
- The script type radio only appears for a plain xpub. A descriptor carries its own.
- Tracking an existing wallet keeps its name; the name typed in the form is dropped.
- The `xpub6CQr…` wallet holds 0.1 BTC from the seeded chain's payment on 2026-03-01, which tells it apart from an empty account.
- A click can miss when the layout has just shifted, for example when a hint, an error or the script type radios appear, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
