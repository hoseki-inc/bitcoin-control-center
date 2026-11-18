# Forgot PIN

From the PIN screen, `Forgot PIN?` shows how to reset a forgotten PIN on the user's platform, keeping their data. On Umbrel that is a terminal command with a copy button, then a restart. This recipe only reads the steps and changes nothing.

## Sub-features

Proves: `forgot`, `umbrel-steps`

`umbrel-reset` is not claimed: it needs the command run and Sentinel restarted, which a verify run can't do. The StartOS and desktop steps need those platforms.

## How to get to it (user POV)

- `Forgot PIN?` on `Enter your PIN`.

## Driving it with the browser

Preconditions: a run launched with `helpers/verify launch --pin`, in a tab that is signed out. Seeding doesn't matter.

- **Open**: on `Enter your PIN`, click `Forgot PIN?`. `Reset your PIN` reads `Your accounts and history stay as they are.`
- **Steps**: three steps: `Open the umbrelOS terminal (Settings, Advanced settings).`, `Run this command:` with `sudo docker exec bitcoin-control-center_web_1 node /app/dist/cli.js reset-pin` and a `Copy command` button, and `Restart Bitcoin Control Center, then set a new PIN right away.`
- **Copy**: click `Copy command`. A `Copy` tooltip shows.
- **Back**: click `Back`. `Enter your PIN` shows again.
- **Stored proof**: `helpers/verify query --sql "SELECT failed_attempts, pin_set_at, pin_hash IS NOT NULL AS has_pin FROM profiles"` into `stored.json`: the PIN is unchanged.

## Gotchas

- Never run the command. It targets an Umbrel container and would do nothing useful on a verify run.
- The browser tool can't read the clipboard, so this recipe doesn't check what `Copy command` copies.
- A screenshot can show the frame before the last action. Wait a second before capturing, and trust the page's text over the picture.
