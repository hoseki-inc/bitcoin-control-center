# Hardware wallet test page

A developer page reads the connected hardware wallet's details and prints them as JSON in a text box: the Ledger's model, or a Trezor's label and model. This recipe drives the Ledger button against the run's emulated Ledger.

## Sub-features

Proves: `ledger-details`

`ledger-error` is not claimed: it needs `emulator disconnect`, which comes in a later change. Trezor is not driven.

## How to get to it (user POV)

- `/test/hardware-wallets` directly. No menu links to it.

This recipe drives that route.

## Driving it with the browser

Preconditions: a run launched with `helpers/verify launch --emulator ledger --ledger-model flex`, seeded, doctor passing. Open the app at the `open:` URL launch printed (the bridge's drive URL), never the Sentinel URL: only the drive URL reaches the Ledger.

Steps:

- **Fresh page**: open `/test/hardware-wallets` on the drive URL, or reload it, so the page starts with no Ledger connected. The heading `Hardware Wallet Test Page` shows the buttons `Show Trezor Device Details` and `Show Ledger Device Details` and an empty text box.
- **First click**: click `Show Ledger Device Details`. The box shows `{ "model": "Unknown" }`. This is a known app bug, recorded as a finding: the page reads the model it held before connecting.
- **Second click**: click `Show Ledger Device Details` again. The box shows `{ "model": "Ledger Flex" }`.
- **Device side**: `helpers/verify emulator status --device ledger` still shows `screen=idle`: reading the model asks nothing on the device.

## Gotchas

- Reload before each pass. Once the Ledger is connected, the page keeps it until a reload, so a second pass on the same page skips the first-click result, and after a disconnect on the same page the next details read still returns the model it cached (a known app bug, recorded as a finding; a toast can still appear). The disconnect check, in a later change, must reload the page first.
- The first click right after the page loads can show nothing, while the page is still settling or the Ledger is still connecting; later results then look one click behind. Wait until the buttons are stable before the first click, and after each click wait for the text box to change before clicking again.
- The model is `Ledger Flex` with a non-breaking space (U+00A0) between the words, as Ledger's own device list spells it. Match the text with any whitespace between `Ledger` and `Flex`.
