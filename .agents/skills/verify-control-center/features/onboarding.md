# Onboarding

A new user opening Control Center with no accounts sees a five-step introduction over Home. Continue and Back move between steps, a click on the backdrop leaves it open, and Escape closes it like Skip. Once closed, it stays closed. This recipe saves the onboarding choice.

## Sub-features

Proves: `opens-first-run`, `steps`, `escape`, `does-not-return`

`skip`, `not-now` and `add-account` are not claimed: the choice is saved once per data folder, so each needs its own fresh run.

## How to get to it (user POV)

- Open Control Center for the first time.

## Driving it with the browser

Preconditions: a run launched with `helpers/verify launch --fresh` and not seeded. Drive this recipe before any other on that run.

- **Opens**: go to `/`. The URL becomes `/home` and a dialog shows `Your Bitcoin, in one place`, `Step 1 of 5`, step dots, and buttons `Skip` and `Continue`.
- **Steps**: click `Continue`. `Step 2 of 5` reads `Bring in what you already use` and adds `Back`. Click `Back`: `Step 1 of 5`. Continue to `Step 5 of 5`, which offers `Back`, `Not Now` and `Add Account` instead of `Skip` and `Continue`.
- **Backdrop**: click `Back` to step 4, then click the gradient background outside the centered card (for example near a corner of the window). The introduction fills the window, so there is no separate overlay element: the background is the dialog's own content. It stays open on step 4.
- **Escape**: press Escape. The dialog closes and Home shows its empty state.
- **Stays closed**: reload. No dialog.
- **Stored proof**: `helpers/verify query --sql "SELECT key, value FROM settings"` into `stored.json`: `onboarding_v1` is `dismissed`.

## Gotchas

- The dialog fades between steps. Read the step number after a second; a heading read too early belongs to the previous step.
- The step illustrations show sample numbers, such as `$68,475.00`. They are not the run's data.
- A click can miss when the layout has just shifted, or while a page fades in after loading. Check the result after every click, and find the element again before retrying.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
