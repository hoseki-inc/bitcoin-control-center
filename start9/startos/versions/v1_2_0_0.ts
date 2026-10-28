import { VersionInfo } from '@start9labs/start-sdk'

export const v1_2_0_0 = VersionInfo.of({
  version: '1.2.0:0',
  releaseNotes: `Faster pages and self-custodial statements.

- Faster loading: balances appear right away from your last sync while Control Center refreshes them in the background, and pages fill in place instead of waiting behind a spinner. This is most noticeable over Tor.
- Statements: now described as self-custodial. They're generated on your machine and show the date each wallet's ownership was proven.
- Getting started: new installs open with a short introduction you can skip.
- Help: a new Help button next to Lock and Settings opens the help center.

Existing accounts, settings, and statements carry over automatically.`,
  migrations: {},
})
