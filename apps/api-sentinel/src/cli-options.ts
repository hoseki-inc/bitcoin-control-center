import type { SentinelServerOptions } from './main'

/**
 * `pnpm dev:desktop` runs Sentinel as the desktop app does: with saved connections,
 * and with settings available even while the Electrum server is unreachable.
 */
export function cliOptions(argv: readonly string[]): SentinelServerOptions {
  return argv.includes('--desktop')
    ? { connectionProfiles: true, waitForElectrum: false, statementSourceSetting: true }
    : {}
}
