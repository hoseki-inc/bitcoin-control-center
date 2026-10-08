import { sdk } from './sdk'

/**
 * Register both dependencies with StartOS so they appear on the service dashboard. Electrs
 * supplies balances and history, and mempool supplies statement prices and transaction details.
 */
export const setDependencies = sdk.setupDependencies(async () => ({
  electrs: { kind: 'running', versionRange: '*', healthChecks: [] },
  mempool: { kind: 'running', versionRange: '*', healthChecks: [] },
}))
