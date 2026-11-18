# Dismiss the public server notice

On desktop, a user who keeps the public server can close the notice that suggests their own node. It stays closed on every later page load. This recipe saves the dismissal.

## Sub-features

Proves: `public-dismiss`

## How to get to it (user POV)

- The `Dismiss` button on the strip above the header.

## Driving it with the browser

Preconditions: a run launched with `--desktop` on which no server has been connected, so the strip shows. Drive it after `onboarding-server-public.md` on the same fresh run, or on any desktop run before `notices-public-server.md`.

- **See it**: on `/home`, the strip `Want more privacy? Look up your wallets on your own node.` shows above the header with `Connect your node` and `Dismiss`.
- **Dismiss**: click `Dismiss`. The strip is gone and the page starts with the header.
- **Stored proof**: `helpers/verify query --sql "SELECT key, value FROM settings WHERE key IN ('electrum_notice_v1','electrum_host')"` into `stored.json`: `electrum_notice_v1` is `dismissed`, with no `electrum_host`.
- **Stays hidden**: go to `/settings`, a full page load. No strip.

## Gotchas

- Once dismissed, the strip never comes back on that data folder, so `notices-public-server.md` can't run after this recipe on the same run.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
