# Settings security

With PINs on, Settings has a Security section. Change PIN asks for the current PIN, a new one, and the new one again, refusing a wrong current PIN and a confirmation that doesn't match. Sign out everywhere ends every signed-in tab at once. This recipe changes the PIN and changes it back, then signs out, so the browser ends signed out.

## Sub-features

Proves: `change-pin`, `wrong-current`, `mismatch`, `sign-out-everywhere`

`hidden-without-pin` is not claimed here: it needs a run without `--pin`.

## How to get to it (user POV)

- The settings (gear) button in the header, then `Security`.

## Driving it with the browser

Preconditions: a seeded run launched with `helpers/verify launch --pin`, so the run's PIN is `246813`.

- **Section**: go to `/settings` and sign in with `246813`. `Security` reads `Your PIN locks Control Center when you close it.` with buttons `Change PIN` and `Sign out everywhere`.
- **Wrong current PIN**: click `Change PIN`. `Enter your current PIN`, `Step 1 of 3`. Type `111111`: `Wrong PIN. Try again.` Type `111112`, then `111113`: `Wrong PIN. 2 more tries before a short wait.`
- **Stored proof, wrong**: `helpers/verify query --sql "SELECT failed_attempts, pin_set_at FROM profiles"` into `stored.json`: `failed_attempts` `3`.
- **Mismatch**: type `246813`. `Choose a new PIN`, `Step 2 of 3`. Type `135792`: `Confirm your new PIN`, `Step 3 of 3`. Type `135799`: back on step 2 with `Those PINs didn’t match. Choose your PIN again.`
- **Change**: type `135792`, then `135792` again. `PIN accepted.` shows and the dialog closes. The same query shows a new `pin_set_at` and `failed_attempts` `0`, and `helpers/verify doctor` fails `pin` with `Sentinel refused the run's PIN 246813`.
- **Change it back**: `Change PIN` again: current `135792`, new `246813`, confirm `246813`. The query shows another new `pin_set_at`, and the doctor passes.
- **Sign out everywhere**: open a second tab at `/home` and sign in. In the first tab, click `Sign out everywhere`. It asks nothing: the page reloads to `Enter your PIN`. In the second tab, click link `Accounts`: `Enter your PIN`.

## Gotchas

- Change the PIN back before any helper command. Until then the doctor and seed fail, and each failed sign-in counts as a wrong PIN toward the next wait.
- Change PIN shows no toast; `PIN accepted.` shows for a moment before the dialog closes.
- Wrong PINs here count toward the same wait as sign-in. Stop at three.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
