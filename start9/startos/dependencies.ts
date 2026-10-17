import { sdk } from './sdk'

/** Electrs host and plaintext Electrum port, from the Electrs wrapper's `startos/utils.ts`. */
export const electrsHostId = 'electrum'
export const electrsPort = 50001

/** Mempool web UI host and port, from the mempool wrapper's `startos/utils.ts`. */
export const mempoolHostId = 'main'
export const mempoolPort = 8080

/** Electrs supplies balances and history. */
const electrs = sdk.Dependency.required('electrs', {
  description: 'Required for on-chain Bitcoin data (address balances, transaction history).',
  metadata: {
    title: 'Electrs',
    icon: 'https://raw.githubusercontent.com/Start9Labs/electrs-startos/refs/heads/master/icon.svg',
  },
  // The range mempool's wrapper requires for the same plaintext Electrum bridge lookup.
  versionRange: '>=0.11.1:11',
  kind: 'running',
  healthChecks: ['electrs', 'sync'],
})

/** Mempool supplies statement prices and transaction details. */
const mempool = sdk.Dependency.required('mempool', {
  description: 'Required for Bitcoin prices and transaction details in statements.',
  metadata: {
    title: 'Mempool',
    icon: 'https://raw.githubusercontent.com/Start9Labs/mempool-startos/refs/heads/master/icon.svg',
  },
  // Its wrapper source at this release exports the web UI under the host above.
  versionRange: '>=3.3.1:10',
  kind: 'running',
  healthChecks: ['webui'],
})

export const dependencies = sdk.Dependencies.of().addDependency(electrs).addDependency(mempool)
