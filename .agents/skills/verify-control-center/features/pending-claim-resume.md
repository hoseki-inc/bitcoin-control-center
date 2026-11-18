# Pending account

A user starts verifying an account and stops before signing. Accounts shows it with a Pending badge and counts it. Opening it asks Continue Verification?, where Continue returns to signing and Abandon removes it after a confirmation. Archive Account also works on a pending account. This recipe adds two pending accounts and leaves neither in the list.

## Sub-features

Proves: `pending-card`, `resume-screen`, `continue`, `abandon`, `archive-pending`

## How to get to it (user POV)

- A pending account's card on Accounts opens `/accounts/<id>`.
- `/accounts/<id>` directly.

This recipe drives the card. It makes the pending accounts through Manually Sign.

## Driving it with the browser

Preconditions: the baseline. The keys are single keys from Bitkey's public sample export, used here as single-sig wallets that no other account holds.

- **Make the first**: Accounts, link `Add Account`, tile `Manually Sign`. Type `Verify Pending Abandon` in `Display name` and `xpub6CeEJqRzUbpUHsEkbz65NLzHYzrT5TpngE2pmuikVFJgSwU7hjEVpjeroQkdbGKLksMDnXPRxvif9jM2jBGxBXKdZYXNBLwG23tEqkAneEn` in `Account descriptor or extended public key`, pick `Native SegWit (P2WPKH)`, click `Add Account`. The URL becomes `/accounts/<id>/signing`. Do not sign.
- **Make the second**: the same with `Verify Pending Archive` and `xpub6CF6yNxSPoNFJESR4xoxzTGKF6GZad5zdB14waPanqnkFWsNAuYNzq2y7nZk5TGiPcGjY8P3ZwrdixbsSp9uVMZ4QtRkMdUNHUsabMnPbKD`.
- **Pending card**: click link `Accounts` in the navigation. The header counts `2 Pending`; both cards carry a `Pending` badge and `0.00000000 BTC`.
- **Resume screen**: click the `Verify Pending Abandon` card. The URL is `/accounts/<id>` and `Continue Verification?` shows with buttons `Abandon` and `Continue`.
- **Continue**: click `Continue`. The URL becomes `/accounts/<id>/signing` with `Address`, `Message` and `Signature`. Go back with browser Back: the resume screen shows again.
- **Abandon**: click `Abandon`. The dialog `Abandon Account Setup?` says it removes `Verify Pending Abandon` and its captured history and cannot be undone. Click the dialog's `Abandon`. A toast says setup was abandoned and the URL becomes `/accounts`, where the card is gone and the header counts `1 Pending`.
- **Archive a pending account**: open the `Verify Pending Archive` card and click `Archive Account`. Confirm with the dialog's `Archive`. The card leaves the list, the header no longer counts a pending account, and `Archived (1)` lists `Verify Pending Archive`.
- **Stored proof**: `helpers/verify query --sql "SELECT display_name, status, deleted_at IS NOT NULL AS archived FROM accounts WHERE display_name LIKE 'Verify Pending%'"` into `stored.json`: no `Verify Pending Abandon` row, and `Verify Pending Archive` with status `pending` and `archived` 1. A `Verify Pending Track` row from the add-track-xpub recipe may also show, `unverified`.

## Gotchas

- Signing would verify the account and end this recipe. Never fill `Signature`.
- `Archived` is collapsed below the list. Open it, or go to `/accounts#archived`.
- A click can miss when the layout has just shifted, for example when the script type radios appear or a page is still fading in. Check the result after every click and find the element again before retrying.
