# Settings name

A user saves the name that goes on their statements. Save name stays disabled until the name changes, the saved name is still there after a reload, and a new statement starts with it in the Name field.

## Sub-features

Proves: `save`, `save-disabled`, `persists`, `prefills-statement`

Run `helpers/verify evidence begin settings-name` before driving it and `helpers/verify evidence record settings-name --status <status>` after.

## How to get to it (user POV)

- The settings (gear) button in the header.
- `/settings` directly.

This recipe drives the second entry point.

## Driving it with the browser

Preconditions: a launched, seeded run whose doctor passes. No name is saved yet.

- **Open Settings**: go to `/settings`. Wait for the heading `Personal information`. Textbox `Your name` is empty and button `Save name` is disabled.
- **Save a name**: type `Verify Owner` in `Your name`. `Save name` becomes enabled. Click it. A `Name saved` message shows and `Save name` is disabled again.
- **Stored proof**: `helpers/verify query --sql "SELECT key, value FROM settings WHERE key = 'user_name'"` into `stored.json`. `user_name` is `Verify Owner`.
- **Reload**: reload the page and wait for `Personal information`. `Your name` still shows `Verify Owner` and `Save name` is disabled.
- **Second view**: go to `/statements/create` and expand `Contact Information (optional)`. `Name` shows `Verify Owner`.

## Gotchas

- A standard run is the web build, so Settings shows only `Personal information` and `Bitcoin price`. The statement source and Electrum sections need the desktop build.
- Typing right after the page loads can be lost while it fades in, even after a short wait. Confirm `Save name` is enabled before clicking it, and type again if `Your name` is still empty.
- A click on the `Contact Information (optional)` heading can be lost the same way. Confirm the `Name` field shows before reading it.
