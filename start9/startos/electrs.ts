import type { T } from '@start9labs/start-sdk'
import { electrsHostId, electrsPort } from './dependencies'
import { sdk } from './sdk'

/** Resolve the plaintext Electrum endpoint Electrs exposes on the internal bridge. */
export async function resolveElectrs(effects: T.Effects): Promise<{ host: string; port: string }> {
  // Sentinel needs an address even before Electrs is installed, so fall back to its
  // default port, which refuses connections until Electrs binds it. StartOS re-runs
  // main when the bridge address appears or changes.
  const address = await sdk.host
    .getBridgeAddress(effects, {
      packageId: 'electrs',
      hostId: electrsHostId,
      internalPort: electrsPort,
      // Electrs also publishes a TLS address signed by a CA Sentinel does not trust.
      ssl: false,
      fallbackPort: electrsPort,
    })
    .const()
  const separator = address.lastIndexOf(':')
  return { host: address.slice(0, separator), port: address.slice(separator + 1) }
}
