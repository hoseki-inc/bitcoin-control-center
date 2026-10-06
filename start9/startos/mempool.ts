import type { T } from '@start9labs/start-sdk'
import { sdk } from './sdk'

/** Resolve the optional mempool UI, which proxies its historical-price API. */
export async function resolveMempoolUrl(effects: T.Effects, override?: string | null): Promise<string> {
  if (override != null && override !== '') {
    return override
  }
  // Reactive lookup: absence returns null, rather than waiting for installation.
  // StartOS can re-run main when the exported bridge address changes.
  const localUrl = await sdk.serviceInterface
    .get(
      effects,
      { packageId: 'mempool', id: 'webui' },
      // Plain HTTP over the internal bridge; the TLS address uses a certificate Sentinel does not trust.
      (service) =>
        service?.addressInfo
          ?.filter({ kind: 'bridge', predicate: (hostname) => !hostname.ssl && hostname.metadata.kind === 'ipv4' })
          .format()[0] ?? null,
    )
    .const()
  return localUrl ?? 'https://mempool.space'
}
