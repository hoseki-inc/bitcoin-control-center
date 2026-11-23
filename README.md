Fixture renders, not live-device runs. The real Ledger/Trezor signing components were rendered with the repo test harness
(synthetic claim, mocked device signature OK, tRPC challengeMessages.complete rejected), the DOM dumped, then screenshotted
in headless Chromium (JS off). before = base 6641ee43 (PR #456 head); after = base + UX-062 diff.
- trezor-multisig-internal: INTERNAL_SERVER_ERROR "Failed to parse account descriptor."
- ledger-singlesig-internal / trezor-singlesig-internal: same INTERNAL_SERVER_ERROR
- ledger-multisig-badrequest: BAD_REQUEST "Invalid signature"
