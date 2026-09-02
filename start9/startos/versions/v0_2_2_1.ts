import { VersionInfo } from '@start9labs/start-sdk'

export const v0_2_2_1 = VersionInfo.of({
  version: '0.2.2:1',
  releaseNotes: 'This release improves wallet compatibility, StartOS reliability, security, and exchange setup guidance.

- Fixed blank screens during hardware-wallet verification and after completing claim verification.
- Restored reliable Trezor connections using the popup flow.
- Fixed Ledger connection failures while importing extended public keys.
- Fixed restored StartOS tabs and direct links returning an internal server error after inactivity.
- Removed an unused resource-intensive statement endpoint. Statement downloads continue to work entirely in the browser.
- Updated vulnerable dependencies, resolving all actionable moderate-or-higher security findings.
- Clarified that Coinbase connections require ECDSA (Legacy SDKs) API keys.
- Updated the Kraken and Robinhood API settings links.
- Updated the StartOS description to reflect privacy-first Bitcoin accounting, supported account types, proof-of-ownership statements, and user-selected Electrum servers.
- Added regression tests for restored StartOS routes and API error handling.

No database migrations or data-model changes are required.',
  migrations: {},
})
