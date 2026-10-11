import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { accounts } from '../../db/schema'
import { setupDistinctWalletNames, setupTwoExchangeAccounts } from './service.fixtures'

it('reports progress while generating, then clears it when the statement completes', async () => {
  const { service, input } = await setupDistinctWalletNames()
  const id = (await service.create(input)).unwrap()
  await expect(service.findById(id)).resolves.toMatchObject({ status: 'pending', progress: 0 })

  // Read progress while each transaction is being looked up.
  const seen: number[] = []
  const lookup = vi.mocked(fetch).getMockImplementation()
  vi.mocked(fetch).mockImplementation(async (...args) => {
    seen.push((await service.findById(id))?.progress ?? -1)
    return lookup ? lookup(...args) : expect.fail('Transaction lookups must be mocked')
  })

  const data = (await service.generateStatementData(input, id)).unwrap()

  // Both lookups start together, once the wallets' history is in.
  expect(seen).toEqual([11, 11])
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

it('records no source for a statement with only exchange accounts', async () => {
  const { service, input } = await setupTwoExchangeAccounts()
  const id = (await service.create(input)).unwrap()

  await expect(service.findById(id)).resolves.toMatchObject({ txSource: null })
})

it('fails a statement when a wallet is archived while its transactions are looked up', async () => {
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
