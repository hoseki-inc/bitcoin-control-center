# Rename an account

A user renames a wallet account from its page. The name can't be empty or longer than 255 characters, Cancel keeps the old name, and the new name shows on the page and in the account list. This recipe renames a seeded account and then renames it back, so the run ends as it started.

## Sub-features

Proves: `rename-account`, `rename-validation`, `rename-cancel`

## How to get to it (user POV)

- Accounts in the navigation, an account's card, then `Rename`.
- `/accounts/<account id>` directly, then `Rename`.

This recipe drives the first entry point.

## Driving it with the browser

Preconditions: the baseline.

- **Open the account**: click link `Accounts` in the navigation, then the card `Verify Watch Taproot`. The URL becomes `/accounts/<id>`.
- **Open rename**: click button `Rename`. A textbox shows `Verify Watch Taproot`, with buttons `Save` and `Cancel`. Its visible label is `Name`; its accessible name is its placeholder, `Your claim name`.
- **Empty name**: select the text and delete it. `Save` is disabled.
- **Too long**: type 255 characters. `Save` is enabled. Type one more. `Save` is disabled. No message explains why.
- **Cancel**: click `Cancel`. The heading still reads `Verify Watch Taproot`.
- **Rename**: click `Rename`, replace the name with `Verify Taproot Renamed` and click `Save`. The heading reads `Verify Taproot Renamed`.
- **Second view**: click link `Accounts`. The card reads `Verify Taproot Renamed` with `0.05000000 BTC`.
- **Stored proof**: `helpers/verify query --sql "SELECT id, display_name FROM accounts WHERE id = '<id>'"` into `stored.json`: `Verify Taproot Renamed`.
- **Rename back**: open the card, click `Rename`, replace the name with `Verify Watch Taproot` and press Enter. The heading reads `Verify Watch Taproot`. Run the same query and add its result to `stored.json` under its own key.

## Gotchas

- A successful rename shows no toast. Check the heading.
- Select the old name before typing. Typing into the prefilled box appends to it.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
