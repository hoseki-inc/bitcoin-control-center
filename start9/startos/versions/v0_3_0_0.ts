import { VersionInfo } from '@start9labs/start-sdk'

export const v0_3_0_0 = VersionInfo.of({
  version: '0.3.0:0',
  releaseNotes: `Mac and Windows desktop apps, saved Electrum connections with Tor, reliable Bitcoin prices, and security fixes.

- Added Mac (Apple Silicon) and Windows installers to releases, built from the same source as the StartOS package and covered by the release checksums.
- Desktop: save up to five named Electrum connections, each with its own Tor setting, and switch between them in Settings. A connection that fails to connect never replaces the one that works.
- Desktop: Tor connections only ever go through Tor. If Tor fails, Settings shows it and retries Tor rather than connecting directly. Onion addresses always use Tor.
- Desktop: Settings and local data stay available while the Electrum server is unreachable, and connections recover on their own after sleep or a network change.
- Desktop: Trezor approvals and device selection now work, and reopening, minimizing, and quitting the app behave consistently.
- Desktop: the app uses its own port, so it no longer conflicts with other local services. The sidebar and statements-banner display settings reset once after updating.
- Fixed USD values showing $0. The Bitcoin price now comes from a source you choose in Settings, with automatic fallbacks: your own mempool server, Block, mempool.space, Coinbase, and CoinGecko.
- Statements now stop with an error, instead of finishing incomplete, if the Electrum server can't return an address's history.
- Fixed two ways a web page could send requests to the desktop app's local server.
- Refreshed shared styling with larger touch targets, visible keyboard focus, and reduced-motion support.
- Updated Electron, the Node.js runtime, and dependencies with security fixes.

Existing accounts, settings, and the saved Electrum server carry over automatically.`,
  migrations: {},
})
