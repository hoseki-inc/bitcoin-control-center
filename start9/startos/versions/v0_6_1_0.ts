import { VersionInfo } from '@start9labs/start-sdk'

export const v0_6_1_0 = VersionInfo.of({
  version: '0.6.1:0',
  releaseNotes: `Signing and branding update.

- StartOS packages are now signed with Hoseki's permanent signing key, so future versions can update in place.
- The Hoseki icon is back in the app, on StartOS, and on desktop. The Mac icon now looks right at small sizes.
- Website and support links now point to bitcoincontrolcenter.com.

Installs from earlier versions, which used a temporary signing key, need a fresh install.`,
  migrations: {},
})
