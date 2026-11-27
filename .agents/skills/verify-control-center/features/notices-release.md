# Release update notice

In the packaged macOS Electron app, when the release check finds a version newer than the app, a notice at the bottom of the window names it with a `Download` link and a `Dismiss` button. Dismissing it hides it until the app's page loads again. This recipe changes no data.

## Sub-features

Proves: `release`, `release-dismiss`

## How to get to it (user POV)

- Any page of the packaged desktop app, once a newer release is published.

## Driving it with CDP (`helpers/verify launch --electron --release-tag v99.0.0_0`)

Preconditions: a seeded macOS run launched with `helpers/verify launch --electron --release-tag v99.0.0_0`, unlocked with `246813`. Launch points the release check at the fake mempool's `/latest.json`, which serves that tag, so the check never leaves `127.0.0.1`.

- **See the notice**: open `/home`. At the bottom of the window, `Bitcoin Control Center 99.0.0 is available.` shows with link `Download` and button `Dismiss`, inside the notice's element with ARIA role `status`. Wait for the text `Bitcoin Control Center 99.0.0 is available.` to be visible, not for the `status` element: it is an `output` with no size of its own, so a visibility wait on it times out while its text shows.
- **Download link**: read link `Download`'s `href` without opening it: `https://www.bitcoincontrolcenter.com/#downloads`.
- **Dismiss**: click button `Dismiss` inside that `status` element. The notice is gone. Click link `Settings`, then link `Home`: it stays gone.
- **Back after a reload**: reload the page (`page.reload()` over CDP) and unlock with `246813` if asked. The notice shows again: the dismissal lasts only while the page stays loaded, as after a relaunch.
- **Stored proof**: the dismissal is kept in the page's memory, so there is no database row. Instead, `logs/fake-requests.log` in the run's scratch folder holds a `GET /latest.json` line answered `200`. Copy that line into `stored.json`. `helpers/verify doctor` passes.

## Gotchas

- The public server notice, `Want more privacy?`, shows on the same page with its own `Dismiss`. Both notices have role `status`. Find the release notice's `Dismiss` within the `status` element holding `99.0.0 is available`.
- Never click `Download` in a scripted run: it opens the real website in the system browser. Reading the `href` proves the target.
- `--release-tag` needs `--electron`. Without it, `--electron` turns release checks off.
- The first check runs as the app starts. If the notice hasn't shown, wait a few seconds; the page asks again every 3 seconds while the check is pending.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
