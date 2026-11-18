# Bitkey

A user adds a Bitkey by pasting the wallet descriptor export from the Bitkey app. A short guide shows how to export it, with the step kept in the URL. The pasted export is checked, the three keys are shown, and the user names the account. It is added as Unverified, because Bitkey can't sign the ownership message, and it never offers verification. Adding the same Bitkey again opens the existing account. This recipe adds one account.

## Sub-features

Proves: `guide`, `step-in-url`, `import`, `name-validation`, `connected`, `already-connected`, `cannot-verify`

`import-errors` is not claimed: this recipe drives the missing `Internal:` line, a mismatched pair and a 1-of-3 export, but has no testnet export.

## How to get to it (user POV)

- Add Account, then the `Bitkey` tile.
- `/accounts/verify/bitkey` directly, optionally with `?step=`.

This recipe drives the first entry point.

## Driving it with the browser

Preconditions: the baseline. The export is the Bitkey app's public sample (`Wallets.bitkeyExport` in `packages/testing/wallets.ts`): an `External:` line, a blank line, and an `Internal:` line. Each is `wsh(sortedmulti(2,K1/<n>/*,K2/<n>/*,K3/<n>/*))` with `<n>` `0` for External and `1` for Internal, and these keys:

- K1 `[a0a76f7a/84'/0'/0']xpub6CeEJqRzUbpUHsEkbz65NLzHYzrT5TpngE2pmuikVFJgSwU7hjEVpjeroQkdbGKLksMDnXPRxvif9jM2jBGxBXKdZYXNBLwG23tEqkAneEn`
- K2 `[18240e16/84'/0'/0']xpub6CF6yNxSPoNFJESR4xoxzTGKF6GZad5zdB14waPanqnkFWsNAuYNzq2y7nZk5TGiPcGjY8P3ZwrdixbsSp9uVMZ4QtRkMdUNHUsabMnPbKD`
- K3 `[afc9474a/84'/0'/0']xpub6CHktMjw1eKdvXgiYdzHVr58KfKnoZpZHqDmTD8MMPJA5vom1sd1TdrNnNESvrxXgZDUMeyBjg2wQYnmMXB767nwh5Z8eNDeFmdPrDdmKaq`

Steps:

- **Intro**: Accounts, link `Add Account`, tile `Bitkey`. The heading `Connect Your Bitkey` explains the three keys and shows an `Unverified` note that Bitkey can't prove ownership. Buttons `Back` and `Next`.
- **Guide**: click `Next` four times. The URL's `step` goes `export-1`, `export-2`, `export-3`, `export-4`; the last heading is `Send It to This Device`. Click `Back` once: `export-3`. Click `Next`.
- **Step in URL**: reload the page. It reopens on `export-4`, `Send It to This Device`.
- **Import step**: click `Next`. The URL has `step=import` and the heading `Add Your Wallet Descriptor` shows the `Wallet descriptor` box and `Continue`.
- **Missing line**: paste only the `External:` line and click `Continue`. The message `Paste everything the Bitkey app exported: both the “External:” and the “Internal:” line.` shows and the step stays `import`.
- **Other bad exports**: paste the full export with K3 replaced by K1 on the `Internal:` line, then the full export with `sortedmulti(2,` changed to `sortedmulti(1,` on both lines. They show `The External and Internal descriptors don’t match. Export the descriptor again.` and `Bitkey wallets are 2-of-3 multisig, but this descriptor describes a different wallet.`, and the step stays `import`.
- **Import**: paste the full export and click `Continue`. The URL has `step=confirm` and the heading `We Found Your Bitkey` lists `Phone key`, `Hardware key` and `Block key`, a `Name` field holding `Bitkey`, and the `Unverified` note.
- **Name validation**: clear `Name` and click `Add Bitkey`. The message `Give this account a name` shows. Fill it with 256 `a` characters: `Keep the name under 255 characters` shows, `Add Bitkey` is disabled and nothing is added. Replace it with `Verify Bitkey`.
- **Connected**: click `Add Bitkey`. The URL has `step=done`; the heading `Bitkey Connected!` shows `0.00000000` BTC, `$0.00` and an `Unverified` badge.
- **Cannot verify**: click `View Bitkey`. The URL becomes `/accounts/<id>`, headed `Verify Bitkey`, with Status `Unverified`, Claim Type `Bitkey`, Quorum `2 of 3` and the three keys. The page offers `Archive Account` and `Rename`, and no Verify, Prove or Continue control.
- **Already connected**: open `/accounts/verify/bitkey?step=import`. The box is empty. Paste the full export, `Continue`, `Add Bitkey`. Toast `This Bitkey is already connected`; the page is `Verify Bitkey`'s.
- **Second view**: Accounts lists one `Verify Bitkey` card, Unverified.
- **Stored proof**: `helpers/verify query --sql "SELECT a.display_name, a.status, count(k.id) AS keys, group_concat(DISTINCT k.wallet) AS wallet FROM accounts a JOIN keystores k ON k.account_id = a.id WHERE a.display_name = 'Verify Bitkey' GROUP BY a.id"` into `stored.json`: one row, `unverified`, 3 keys, wallet `bitkey`.

## Gotchas

- Type the export with real line breaks, or set the box's value directly; pressing Enter in the box may submit it.
- Reload keeps the step but not the pasted text, so the import step starts empty after a reload.
- The guide's phone pictures show made-up activity and a made-up price. They are illustrations, not data from the run.
- A click can miss when the layout has just shifted, for example when a hint, an error or the script type radios appear, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
