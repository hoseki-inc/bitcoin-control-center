# App shell

A user moves around Control Center from the header: the logo and Home, Accounts, Portfolio and Statements, plus Help and Settings. The current page's link is marked, `/` lands on Home, and there is no Lock button while PINs are off. This recipe changes no data.

## Sub-features

Proves: `nav-links`, `logo-home`, `settings-button`, `root-redirect`, `no-lock-without-pin`

## How to get to it (user POV)

- Any page with the header.
- `/` directly.

## Driving it with the browser

Preconditions: the baseline.

- **Root**: go to `/`. The URL becomes `/home`. The header has link `Bitcoin Control Center` (the logo) to `/home`, links `Home`, `Accounts`, `Portfolio` and `Statements`, link `Help` to the help site and link `Settings` to `/settings`. `Home` has `aria-current="page"`. No button names Lock.
- **Each page**: click `Portfolio`, `Statements` and `Accounts` in turn. Each opens its page, and only its own link has `aria-current`.
- **Settings**: click link `Settings`. The URL is `/settings` with the heading `Settings`, and no header link is current.
- **Logo**: click link `Bitcoin Control Center`. The URL is `/home` and `Home` is current.
- **Stored proof**: `helpers/verify query --sql "SELECT count(*) AS accounts FROM accounts"` into `stored.json`: still 3.

## Gotchas

- Help and Settings are icon links. Their accessible names are `Help` and `Settings`; they have no visible text.
- Don't open Help: it is a real outside site. Read its `href` instead (see help-link).
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
