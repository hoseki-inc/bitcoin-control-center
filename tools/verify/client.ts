import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { type CreateTRPCProxyClient, createTRPCProxyClient, httpLink } from '@trpc/client'
import superjson from 'superjson'

/** Sentinel's API as the web app calls it. */
export function sentinelClient(url: string): CreateTRPCProxyClient<Router> {
  return createTRPCProxyClient<Router>({
    transformer: registerCustomSerializers(superjson),
    links: [httpLink({ url: `${url}/trpc` })],
  })
}

/** One account list in Sentinel's API. */
export interface ListQuery {
  list: { query: () => Promise<readonly unknown[]> }
}

/** The account lists Home counts: wallets, exchange accounts, manual holdings and ETF holdings. */
export interface AccountLists {
  portalProve: { registry: { claims: ListQuery }; exchange: ListQuery; manual: ListQuery; etf: ListQuery }
}

/** Every account the app shows, of every kind, so "no accounts" means the app is really empty. */
export async function countAccounts(client: AccountLists): Promise<number> {
  const { registry, exchange, manual, etf } = client.portalProve
  const lists = await Promise.all([registry.claims, exchange, manual, etf].map(async (kind) => kind.list.query()))
  return lists.reduce((total, list) => total + list.length, 0)
}
