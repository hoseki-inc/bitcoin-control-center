# Help link

The Help link in the header opens the help site in a new tab and tells it which build and which area the user came from: `utm_content` is the platform and `screen` is the area. Pages without the header have no Help. This recipe never opens the help site and changes no data.

## Sub-features

Proves: `help-platform`, `help-screen`, `help-not-on-404`

`help-href` is not claimed: opening it reaches a real outside site.

## How to get to it (user POV)

- The `Help` (question mark) icon link in the header on any page.

## Driving it with the browser

Preconditions: a launched run. Read the link's `href`; never click it.

- **Home**: on `/home`, link `Help` points to `https://help.hoseki.app/bitcoin-control-center` with `utm_content=web` and `screen=home`, opens in a new tab (`target="_blank"`) and has `rel="noreferrer"`.
- **Each area**: on `/accounts`, `/portfolio`, `/statements`, `/settings` and `/multisig/create`, `screen` is `accounts`, `portfolio`, `statements`, `settings` and `multisig`. `utm_content` stays `web`.
- **No header**: on `/no-such-page`, `Page not found` shows with no header and no Help link.
- **Stored proof**: save each page's `utm_content` and `screen` into `stored.json`.

## Gotchas

- A standard run is the web build, so `utm_content` is always `web`. `startos`, `umbrel` and `desktop-<os>` need those builds.
- Every page with the header in a normal run maps to a named area, so `screen=other` doesn't show here.
- `utm_term` carries the app version, such as `1.4.2`.
