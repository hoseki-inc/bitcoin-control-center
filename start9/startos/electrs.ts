import type { T } from '@start9labs/start-sdk'
import { electrsHostId, electrsPort } from './dependencies'
import { sdk } from './sdk'

/** Resolve the plaintext Electrum endpoint Electrs exposes on the internal bridge. */
export async function resolveElectrs(effects: T.Effects): Promise<{ host: string; port: string }> {
  // StartOS re-runs main when the bridge address appears or changes.
  const address = await sdk.host
    .getBridgeAddress(effects, {
      packageId: 'electrs',
      hostId: electrsHostId,
      internalPort: electrsPort,
      // Electrs also publishes a TLS address signed by a CA Sentinel does not trust.
      ssl: false,
    })
    .const()
  if (address == null) {
    // Nothing listens on this container's loopback, so Sentinel stays offline until
    // Electrs is installed. The server's port 50001 may belong to another service.
    return { host: '127.0.0.1', port: String(electrsPort) }
  }
  const separator = address.lastIndexOf(':')
  return { host: address.slice(0, separator), port: address.slice(separator + 1) }
}
