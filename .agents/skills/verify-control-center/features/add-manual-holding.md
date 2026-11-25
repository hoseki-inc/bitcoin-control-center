# Manual holding

A user tracks bitcoin that isn't in a connected wallet. They give it a name, a balance and an as-of date, then update the balance, log buys and sells, delete a logged transaction and finally remove the holding. Logged transactions can move the balance only when the user asks, and the balance can never fall below what the logged transactions add up to. This recipe adds a holding and removes it again.

## Sub-features

Proves: `add`, `add-disabled`, `detail`, `update-balance`, `update-below-transactions`, `add-transaction`, `transaction-exceeds`, `sell-exceeds`, `delete-transaction`, `remove-account`, `cleared-date`

## How to get to it (user POV)

- Add Account, then `Track Balance, ETF, or xpub`, then `Bitcoin Holdings`.
- `/accounts/verify/manual` directly.
- A manual holding's card on Accounts opens its page, `/accounts/manual/<id>`.

This recipe drives the first entry point to add, and the success screen's `View Holdings` to reach the page.

## Driving it with the browser

Preconditions: the baseline.

- **Open the form**: Accounts, link `Add Account`, tile `Track Balance, ETF, or xpub`, then `Bitcoin Holdings`. The heading `Add Manual Holding` shows `Display Name`, `Balance (BTC)` and `As of Date` (today). Button `Add Holding` is disabled.
- **Needs both**: type `Verify Cold Storage` in `Display Name`. `Add Holding` stays disabled. Type `0.5` in `Balance (BTC)`. It is enabled.
- **Cleared date, add**: clear `As of Date`. `Add Holding` is disabled. Set it to `2026-03-01`. It is enabled.
- **Add**: click `Add Holding`. `Holdings Added!` counts up to `0.50000000` BTC.
- **Detail**: click `View Holdings`. The URL becomes `/accounts/manual/<id>`, with Balance `0.50000000 BTC`, Status `Unverified` and Balance As Of `March 1st, 2026`.
- **Cleared date, update**: type `0.6` in `New Balance (BTC)` and clear its `As of Date`. Button `Update` is disabled. Set the date to `2026-04-01`.
- **Update balance**: click `Update`. Toast `Balance updated`; Balance `0.60000000 BTC`, Balance As Of `April 1st, 2026`.
- **Cleared date, transaction**: under `Add Transaction`, leave `Type` on `Buy`, type `1` in `Amount (BTC)` and clear `Date`. Button `Add` is disabled. Set `Date` to `2026-04-10`.
- **Exceeds**: leave `Add this amount to balance` unticked and click `Add`. Toast `Transaction total would exceed the current balance. Check "Add this amount to balance" or update the balance first.`; no Transactions table appears.
- **Oversell**: switch `Type` to `Sell`, change `Amount (BTC)` to `0.8`, tick `Add this amount to balance`, click `Add`. Toast `This would take the balance below zero. Update the balance first, then log the sell.`; Balance stays `0.60000000 BTC` and no Transactions table appears.
- **Add a transaction**: switch `Type` back to `Buy`, change the amount to `0.2`, type `Verify buy` in `Note (optional)`, leave `Add this amount to balance` ticked, click `Add`. Toast `Transaction added`; Balance `0.80000000 BTC`, Balance As Of `April 10th, 2026`, and a Transactions table with one row: `Buy`, `0.20000000`, `Apr 10, 2026`, `Verify buy`.
- **Below transactions**: type `0.1` in `New Balance (BTC)` with date `2026-04-20` and click `Update`. Toast `Balance cannot be less than net transaction total (20000000 sats)`; Balance stays `0.80000000 BTC`.
- **Delete a transaction**: click the row's `Delete`. The dialog `Delete this transaction?` offers an unticked box `Subtract 0.2 BTC from the balance`. Tick it and click the dialog's `Delete`. Toast `Transaction deleted`; the table is gone and Balance is `0.60000000 BTC`.
- **Second view**: click link `Accounts` in the navigation. A card `Verify Cold Storage` shows `0.60000000 BTC` as Unverified. Open it again.
- **Stored proof, before removal**: `helpers/verify query --sql "SELECT m.display_name, m.balance_sats, m.balance_as_of, (SELECT count(*) FROM manual_transactions t WHERE t.account_id = m.id) AS transactions FROM manual_accounts m"` into `stored.json`: one row, `balance_sats` `60000000`, no transactions.
- **Remove**: click `Remove Account`. The dialog `Remove Verify Cold Storage?` says its history and transactions will be deleted. Click `Remove`. The URL becomes `/accounts` and the card is gone.
- **Stored proof, after removal**: run the same query and add its empty result to `stored.json` under its own key.

## Gotchas

- The success screen counts up to the balance. Read it after it settles, not on the first frame.
- Without `Add this amount to balance`, a transaction only logs history: a buy that would make the logged total exceed the balance is refused, and a sell is accepted without changing the balance.
- The delete dialog's box offers to undo the transaction's effect even when it never moved the balance. Read its label before ticking it.
- `Remove Account` asks first, as it does for ETF and exchange accounts. Only the dialog's `Remove` deletes.
- Dates are the browser's local days. Compare days, not timestamps.
- A click can miss when the layout has just shifted, for example when a hint, an error or the script type radios appear, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
