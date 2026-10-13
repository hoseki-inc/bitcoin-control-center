import { ElectrumServerError } from '@hoseki/packages/clients/electrum/lib/protocol'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { accounts, settings } from '../../db/schema'
import { setupDesktopWallets, setupDistinctWalletNames, setupTwoExchangeAccounts } from './service.fixtures'

it('reports progress through history and lookups, and none once the statement completes', async () => {
  const { service, input, onchainProvider } = await setupDistinctWalletNames()
  const id = (await service.create(input)).unwrap()
  await expect(service.findById(id)).resolves.toMatchObject({ status: 'pending', progress: 0 })

  // Read progress as each wallet's history is fetched, and as each transaction is looked up.
  const atHistory: number[] = []
  const atLookup: number[] = []
  const progress = async (): Promise<number> => (await service.findById(id))?.progress ?? -1
  const getHistory = vi.spyOn(onchainProvider.deps.electrum, 'getHistory')
  const history = getHistory.getMockImplementation()
  getHistory.mockImplementation(
    asyncFn(async (scripthash: string) => {
      atHistory.push(await progress())
      return history ? history(scripthash) : expect.fail('History requests must be mocked')
    }),
  )
  const lookup = vi.mocked(fetch).getMockImplementation()
  vi.mocked(fetch).mockImplementation(async (...args) => {
    atLookup.push(await progress())
    // The spending wallet's lookup waits until the savings one has finished, so progress is read
    // halfway through the lookups too.
    if (new Request(args[0]).url.endsWith('2'.repeat(64))) {
      await vi.waitFor(async () => {
        await expect(progress()).resolves.toBeGreaterThan(44)
      })
      atLookup.push(await progress())
    }
    return lookup ? lookup(...args) : expect.fail('Transaction lookups must be mocked')
  })

  const data = (await service.generateStatementData(input, id)).unwrap()

  // History is the first 4/9 of Sentinel's progress, split between the two wallets. Finding a wallet's
  // addresses is half of its share, so each history request sees that half done.
  expect(atHistory).toEqual([11, 33])
  // Lookups take the next 4/9, from 44%: halfway through them is 66%.
  expect(atLookup[0]).toBe(44)
  expect(atLookup).toContain(66)
  await expect(service.findById(id)).resolves.toMatchObject({ progress: 100 })

  ;(await service.complete(id, data.transactionMap, data.dailyRates)).unwrap()
  await expect(service.findById(id)).resolves.toMatchObject({ status: 'completed', progress: null })
})

it('records where a statement with wallets looks up transactions', async () => {
  const { service, input } = await setupDistinctWalletNames()
  const id = (await service.create(input)).unwrap()

  // The fixtures' mempool server isn't on a private network, so it counts as public.
  await expect(service.findById(id)).resolves.toMatchObject({ txSource: 'public_mempool' })
})

it('records the source chosen in Settings, and generates each statement with the one it recorded', async () => {
  const { service, input, onchainProvider } = await setupDesktopWallets()
  ;(await service.setSourceChoice('electrum')).unwrap()
  const id = (await service.create(input)).unwrap()
  ;(await service.setSourceChoice('mempool')).unwrap()
  const getTransaction = vi
    .spyOn(onchainProvider.deps.electrum, 'getTransaction')
    .mockImplementation(asyncFn(async () => Err(new ElectrumServerError('No such transaction'))))

  const result = await service.generateStatementData(input, id)

  await expect(service.findById(id)).resolves.toMatchObject({ txSource: 'electrum' })
  // Changing the setting afterwards doesn't change where this statement looks transactions up.
  expect(result.expectErr('the Electrum server has no transactions')).toMatchObject({ kind: 'unavailable' })
  expect(getTransaction).toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  const next = (await service.create(input)).unwrap()
  await expect(service.findById(next)).resolves.toMatchObject({ txSource: 'public_mempool' })
})

it('ignores a saved Electrum choice where the source cannot be chosen', async () => {
  const { service, input, db } = await setupDistinctWalletNames()
  await db.insert(settings).values({ key: 'statement_tx_source', value: 'electrum' })

  const id = (await service.create(input)).unwrap()

  await expect(service.findById(id)).resolves.toMatchObject({ txSource: 'public_mempool' })
  expect((await service.setSourceChoice('electrum')).isErr()).toBe(true)
})

it('records no source for a statement with only exchange accounts', async () => {
  const { service, input } = await setupTwoExchangeAccounts()
  const id = (await service.create(input)).unwrap()

  await expect(service.findById(id)).resolves.toMatchObject({ txSource: null })
})

it('reports valid progress for wallets with no transactions', async () => {
  const { service, input, onchainProvider } = await setupDistinctWalletNames()
  vi.spyOn(onchainProvider.deps.electrum, 'getHistory').mockImplementation(asyncFn(async () => Ok([])))
  const id = (await service.create(input)).unwrap()

  ;(await service.generateStatementData(input, id)).unwrap()

  await expect(service.findById(id)).resolves.toMatchObject({ progress: 100 })
})

it('marks transactions confirmed against the current block tip', async () => {
  const { service, input } = await setupDistinctWalletNames()

  const data = (await service.generateStatementData(input)).unwrap()

  const transactions = Object.values(data.transactionMap).flatMap((account) => account.transactions)
  expect(transactions).toHaveLength(2)
  expect(transactions.every((transaction) => transaction.confirmed)).toBe(true)
})

it('fails a statement rather than leaving out a wallet whose descriptor cannot be read', async () => {
  const { service, input, db } = await setupDistinctWalletNames()
  await db.update(accounts).set({ descriptor: 'not a descriptor' }).where(eq(accounts.id, 'wallet-1'))

  const result = await service.generateStatementData(input)

  expect(result.expectErr('a wallet must not drop out of the statement')).toMatchObject({ kind: 'history' })
})

it('logs only the kind of a failed lookup, never its txid', async () => {
  const { service, input, logs } = await setupDistinctWalletNames()
  vi.mocked(fetch).mockImplementation(async () => new Response('Not found', { status: 404 }))

  expect((await service.generateStatementData(input)).isErr()).toBe(true)

  const logged = logs.join('')
  expect(logged).toContain('"kind":"unavailable"')
  expect(logged).not.toContain('1'.repeat(64))
  expect(logged).not.toContain('2'.repeat(64))
})

it('logs only the kind of a failed history request, never its server', async () => {
  const { service, input, onchainProvider, logs } = await setupDistinctWalletNames()
  vi.spyOn(onchainProvider.deps.electrum, 'getHistory').mockImplementation(
    asyncFn(async () => Err(new Error('connect ECONNREFUSED 10.1.2.3:50001'))),
  )

  expect((await service.generateStatementData(input)).isErr()).toBe(true)

  const logged = logs.join('')
  expect(logged).toContain('"kind":"history"')
  expect(logged).not.toContain('10.1.2.3')
})

it.each([
  { scenario: 'refuses', error: (txid: string) => new ElectrumServerError(`No such transaction ${txid}`) },
  { scenario: 'drops the connection', error: () => new Error('connect ECONNREFUSED electrum.example:50002') },
])('logs only the kind when the Electrum server $scenario, never the txid or server', async ({ error }) => {
  const { service, input, onchainProvider, logs } = await setupDesktopWallets()
  ;(await service.setSourceChoice('electrum')).unwrap()
  const id = (await service.create(input)).unwrap()
  vi.spyOn(onchainProvider.deps.electrum, 'getTransaction').mockImplementation(
    asyncFn(async (txid: string) => Err(error(txid))),
  )

  expect((await service.generateStatementData(input, id)).isErr()).toBe(true)

  const logged = logs.join('')
  expect(logged).toMatch(/"kind":"(unavailable|unreachable)"/)
  expect(logged).not.toContain('1'.repeat(64))
  expect(logged).not.toContain('2'.repeat(64))
  expect(logged).not.toContain('electrum.example')
})

it('stops generating when a wallet is archived while its transactions are looked up', async () => {
  const { service, input, db } = await setupDistinctWalletNames()
  const lookup = vi.mocked(fetch).getMockImplementation()
  vi.mocked(fetch).mockImplementation(async (...args) => {
    await db.update(accounts).set({ deletedAt: new Date().toISOString() }).where(eq(accounts.id, 'wallet-1'))
    return lookup ? lookup(...args) : expect.fail('Transaction lookups must be mocked')
  })

  const result = await service.generateStatementData(input)

  expect(result.expectErr('an archived wallet must not end up in the statement').message).toBe(
    'Account "Spending" was archived while generating the statement',
  )
})
