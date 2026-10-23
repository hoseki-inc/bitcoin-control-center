import { Network } from '@hoseki/packages/bitcoin/network'
import { Wallets } from '@hoseki/packages/testing'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { accounts, discoveryCache } from '../../db/schema'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { DiscoveryIndexes } from './discovery-index-store'

const wallet = Wallets.singlesigNativeSegwitAccount
const other = Wallets.singlesigTaprootAccount

async function setup(): Promise<{
  store: DiscoveryIndexes
  db: Awaited<ReturnType<typeof setupServiceDatabase>>['db']
}> {
  const { db } = await setupServiceDatabase()
  await db.insert(accounts).values([
    { id: 'wallet', descriptor: wallet.toString(), displayName: 'Wallet' },
    { id: 'other', descriptor: other.toString(), displayName: 'Other wallet' },
  ])
  return { store: new DiscoveryIndexes(db), db }
}

it('keeps nothing for a wallet that is not saved, and nothing until a scan finds something', async () => {
  const { store, db } = await setup()
  expect((await store.load(wallet, Network.Mainnet)).unwrap()).toBeNull()

  const unsaved = Wallets.singlesigLegacyAccount
  const indexes = { lastUsedReceiveIndex: 4, lastUsedChangeIndex: 2 }
  expect((await store.save(unsaved, Network.Mainnet, indexes, 'raise')).isOk()).toBe(true)
  expect((await store.load(unsaved, Network.Mainnet)).unwrap()).toBeNull()
  await expect(db.select().from(discoveryCache)).resolves.toEqual([])
})

it('saves indexes for the matching wallet only, and never lowers them unless replacing', async () => {
  const { store, db } = await setup()
  await store.save(wallet, Network.Mainnet, { lastUsedReceiveIndex: 40, lastUsedChangeIndex: 12 }, 'raise')
  expect((await store.load(wallet, Network.Mainnet)).unwrap()).toEqual({
    lastUsedReceiveIndex: 40,
    lastUsedChangeIndex: 12,
  })
  expect((await store.load(other, Network.Mainnet)).unwrap()).toBeNull()

  await store.save(wallet, Network.Mainnet, { lastUsedReceiveIndex: 30, lastUsedChangeIndex: 15 }, 'raise')
  expect((await store.load(wallet, Network.Mainnet)).unwrap()).toEqual({
    lastUsedReceiveIndex: 40,
    lastUsedChangeIndex: 15,
  })

  await store.save(wallet, Network.Mainnet, { lastUsedReceiveIndex: 30, lastUsedChangeIndex: 15 }, 'replace')
  expect((await store.load(wallet, Network.Mainnet)).unwrap()).toEqual({
    lastUsedReceiveIndex: 30,
    lastUsedChangeIndex: 15,
  })
  await expect(db.select({ id: discoveryCache.accountId }).from(discoveryCache)).resolves.toEqual([{ id: 'wallet' }])
})

it('starts a wallet added again from the highest indexes of its earlier rows, on its own network only', async () => {
  const { store, db } = await setup()
  await db.update(accounts).set({ deletedAt: '2024-02-01T00:00:00.000Z' }).where(eq(accounts.id, 'wallet'))
  await db.insert(accounts).values([
    { id: 'wallet-again', descriptor: wallet.toString(), displayName: 'Wallet' },
    { id: 'wallet-testnet', network: 'testnet', descriptor: wallet.toString(), displayName: 'Testnet wallet' },
  ])
  await db.insert(discoveryCache).values([
    { accountId: 'wallet', lastUsedReceiveIndex: 50, lastUsedChangeIndex: 3 },
    { accountId: 'wallet-again', lastUsedReceiveIndex: 10, lastUsedChangeIndex: 8 },
    { accountId: 'wallet-testnet', lastUsedReceiveIndex: 90, lastUsedChangeIndex: 90 },
  ])

  expect((await store.load(wallet, Network.Mainnet)).unwrap()).toEqual({
    lastUsedReceiveIndex: 50,
    lastUsedChangeIndex: 8,
  })
  expect((await store.load(wallet, Network.Testnet)).unwrap()).toEqual({
    lastUsedReceiveIndex: 90,
    lastUsedChangeIndex: 90,
  })
})

it('ignores saved descriptors that no longer parse', async () => {
  const { store, db } = await setup()
  await db.insert(accounts).values({ id: 'broken', descriptor: 'not a descriptor', displayName: 'Broken' })
  await store.save(wallet, Network.Mainnet, { lastUsedReceiveIndex: 7, lastUsedChangeIndex: 1 }, 'raise')
  expect((await db.select({ id: discoveryCache.accountId }).from(discoveryCache)).map(({ id }) => id)).toEqual([
    'wallet',
  ])
})

it('reports a database failure as an error instead of throwing', async () => {
  const { store, db } = await setup()
  db.$client.close()
  expect((await store.load(wallet, Network.Mainnet)).isErr()).toBe(true)
  expect(
    (await store.save(wallet, Network.Mainnet, { lastUsedReceiveIndex: 1, lastUsedChangeIndex: 1 }, 'raise')).isErr(),
  ).toBe(true)
})
