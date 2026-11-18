# PIN lock and sign-in

With PINs on, Control Center opens on `Enter your PIN`. Wrong PINs say so, warn before a wait, and then make the user wait 30 seconds, doubling each time. The right PIN opens the app. A reload keeps the tab signed in, while a new tab asks again, and the header's Lock button covers the app until the PIN is entered. This recipe leaves the browser tab signed in.

## Sub-features

Proves: `lock`, `sign-in`, `wrong-pin`, `wait`, `reload-keeps`

`session-ended` is not claimed: this browser pane keeps background tabs visible, so switching back to a tab fires no focus event. `back-forward-locks` needs a page restored from the back-forward cache, which the browser tool doesn't show.

## How to get to it (user POV)

- Open Control Center with PINs on.
- The `Lock` button in the header.

## Driving it with the browser

Preconditions: a seeded run launched with `helpers/verify launch --pin`, so the run's PIN is `246813`. Drive it in a browser tab that hasn't signed in yet.

- **Locked at first**: go to `/`. `Enter your PIN` shows a six-digit field and `Forgot PIN?`, with no app behind it.
- **Wrong PIN**: type `111111`. `Wrong PIN. Try again.` Type `111112`; the same.
- **Tries left**: type `111113`: `Wrong PIN. 2 more tries before a short wait.` Type `111114`: `Wrong PIN. 1 more try before a short wait.`
- **Wait**: type `111115`. `Too many wrong PINs. Try again in 29 seconds.` (or 30), and the field takes no input. `helpers/verify query --sql "SELECT failed_attempts, next_attempt_at FROM profiles"` into `stored.json`: `failed_attempts` `5`.
- **Doubling**: when the message reads `You can enter your PIN again.`, type `111116`. `Too many wrong PINs. Try again in 59 seconds.`
- **Sign in**: after that wait, type `246813`. The app opens on `/home` with a `Lock` button in the header. The same query reads `failed_attempts` `0` and no `next_attempt_at`.
- **Reload keeps it**: go to `/accounts` and sign in again (see Gotchas), then reload the page. It still shows Accounts.
- **New tab asks**: open a new tab at `/home`. It shows `Enter your PIN`, while the first tab stays signed in.
- **Lock**: in the first tab, on `/portfolio`, click `Lock`. `Enter your PIN` covers the app and the URL stays `/portfolio`. Type `246813`: Portfolio shows again.

## Gotchas

- Only a reload keeps a tab signed in. Typing a URL or opening a link from outside the app is a new page load and asks for the PIN, by design. Move around with the app's own links.
- The browser tool's `navigate` is a new page load, not a reload. Reload with the browser's reload, or `location.reload()` if the tool has no other way.
- The waits hold every sign-in for the run, the helper's included: the doctor and seed fail with the wait until it ends.
- The PIN field submits on the sixth digit. Click it before typing; after a wrong PIN it clears itself.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
