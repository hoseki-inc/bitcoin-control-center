# ETF holdings

A user tracks the bitcoin a spot ETF holds for them. They name the account and enter one row per ETF with shares and an optional purchase date, and see an estimated BTC total as they type. The account page shows the computed balance and a holdings table where they add and remove holdings. Removing the account deletes it at once. This recipe adds an ETF account and removes it again.

## Sub-features

Proves: `add`, `rows`, `estimate`, `invalid`, `detail`, `add-holding`, `remove-holding`, `remove-account`

## How to get to it (user POV)

- Add Account, then `Track Balance, ETF, or xpub`, then `Bitcoin ETF Holdings`.
- `/accounts/verify/etf` directly.
- An ETF account's card on Accounts opens its page, `/accounts/etf/<id>`.

This recipe drives the first entry point to add, and the success screen's `View Holdings` to reach the page.

## Driving it with the browser

Preconditions: the baseline. Each ETF's BTC per share comes from a fixed table in `packages/etfs/holdings.ts` and drops a little every day by its expense ratio, so the expected values depend on today's date, not the fake price. Before driving, print today's four expected totals (A to D below) from the repository root:

```bash
node -e "import('./packages/etfs/holdings.ts').then(({ETF_CONFIGS:c,computeHoldingBtcSats:h})=>{const d=new Date(),s=(t,n)=>Number(h(c[t],n,d)),f=(x)=>(x/1e8).toFixed(8);console.log('A',f(s('IBIT',100)),'B',f(s('IBIT',100)+s('FBTC',50)),'C',f(s('IBIT',100)+s('FBTC',50)+s('GBTC',10)),'D',f(s('IBIT',100)+s('GBTC',10)))})"
```

On 2026-11-18 they were A `0.05659690`, B `0.10007180`, C `0.10778292`, D `0.06430802`.

- **Open the form**: Accounts, link `Add Account`, tile `Track Balance, ETF, or xpub`, then `Bitcoin ETF Holdings`. The heading `Add Bitcoin ETF Holdings` shows `Display Name` and one holdings row: `ETF` (`IBIT — iShares Bitcoin Trust`), `Shares` and `Date Purchased`. Button `Add ETF Holdings` is disabled.
- **Invalid shares**: type `Verify Brokerage` in `Display Name` and `0` in `Shares`. No estimate shows and `Add ETF Holdings` stays disabled.
- **Estimate**: replace the shares with `100`. `Estimated BTC Total` shows A and the button is enabled.
- **Future date**: set `Date Purchased` to a date after today, such as `2027-01-01`. `Add ETF Holdings` is disabled. Set it to `2026-01-15`; it is enabled.
- **Rows**: click `+ Add Another ETF`. A second row appears, and each row now has a button `Remove holding N`. Click `+ Add Another ETF` again, then `Remove holding 3`: back to two rows. In the second row pick `FBTC — Fidelity Wise Origin Bitcoin Fund` and type `50`. The estimate becomes B.
- **Add**: click `Add ETF Holdings`. `ETF Holdings Added!` counts up to B.
- **Detail**: click `View Holdings`. The URL becomes `/accounts/etf/<id>`, with Computed Balance B, Status `Unverified`, and a Holdings table: `IBIT`, `BlackRock`, `100`, its BTC per share, A, `Jan 15, 2026`; and `FBTC`, `Fidelity`, `50`, its BTC per share, B minus A, `—`.
- **Add a holding**: under `Add Holding` pick `GBTC — Grayscale Bitcoin Trust`, type `10` in `Shares`, click `Add`. Toast `Holding added`; a `GBTC` row with C minus B, and Computed Balance C.
- **Remove a holding**: click `Remove` on the `FBTC` row. Toast `Holding removed`; the row is gone and Computed Balance is D.
- **Second view**: click link `Accounts` in the navigation. A card `Verify Brokerage` shows D. Open it again.
- **Stored proof, before removal**: `helpers/verify query --sql "SELECT a.display_name, h.ticker, h.shares, h.date_purchased FROM etf_accounts a JOIN etf_holdings h ON h.account_id = a.id ORDER BY h.created_at"` into `stored.json`: `IBIT` 100 with a purchase date on 2026-01-15, and `GBTC` 10 with none.
- **Remove**: click `Remove Account`. With no dialog, the URL becomes `/accounts` and the card is gone.
- **Stored proof, after removal**: `helpers/verify query --sql "SELECT (SELECT count(*) FROM etf_accounts) AS accounts, (SELECT count(*) FROM etf_holdings) AS holdings"` into `stored.json` under its own key: both 0.

## Gotchas

- `Remove Account` deletes at once, with no confirmation. Do it last.
- The stored purchase date carries a time that depends on the browser's time zone. Compare the day.
- The success screen counts up to the total. Read it after it settles.
- The page rounds BTC per share to 8 places, so shares times the shown value can be off by a few sats. Check BTC Amounts against A to D.
- A click can miss when the layout has just shifted, for example when a hint, an error or the script type radios appear, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
