import type { T } from '@start9labs/start-sdk'
import { mempoolHostId, mempoolPort } from './dependencies'
import { sdk } from './sdk'

/** Resolve the mempool UI, which proxies its historical-price API. */
export async function resolveMempoolUrl(effects: T.Effects, override?: string | null): Promise<string> {
  if (override != null && override !== '') {
    return override
  }
  // Reactive lookup: absence returns null, rather than waiting for installation.
  // StartOS re-runs main when the bridge address appears or changes.
  const address = await sdk.host
    .getBridgeAddress(effects, {
      packageId: 'mempool',
      hostId: mempoolHostId,
      internalPort: mempoolPort,
      // Plain HTTP over the internal bridge; the TLS address uses a certificate Sentinel does not trust.
      ssl: false,
    })
    .const()
  return address == null ? 'https://mempool.space' : `http://${address}`
}
