import { expect, it, vi } from 'vitest'
import { setupDistinctWalletNames, setupTwoExchangeAccounts } from './service.fixtures'

it('reports progress that only moves forward, then clears it when the statement completes', async () => {
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

  expect(seen).toHaveLength(2)
  expect(seen.every((progress) => progress > 0 && progress < 100)).toBe(true)
  expect(seen).toEqual([...seen].sort((a, b) => a - b))
  await expect(service.findById(id)).resolves.toMatchObject({ progress: 100 })

  ;(await service.complete(id, data.transactionMap, data.dailyRates)).unwrap()
  await expect(service.findById(id)).resolves.toMatchObject({ status: 'completed', progress: null })
})

it('builds a repeat statement from saved lookups without asking the server again', async () => {
  const { service, input } = await setupDistinctWalletNames()
  const first = (await service.generateStatementData(input)).unwrap()
  const lookups = vi.mocked(fetch).mock.calls.length

  const second = (await service.generateStatementData(input)).unwrap()

  expect(lookups).toBe(2)
  expect(fetch).toHaveBeenCalledTimes(lookups)
  expect(second.transactionMap).toEqual(first.transactionMap)
})

it('records where a statement with wallets looks up transactions', async () => {
  const { service, input } = await setupDistinctWalletNames()
  const id = (await service.create(input)).unwrap()

  // The fixtures use a mempool instance other than mempool.space.
  await expect(service.findById(id)).resolves.toMatchObject({ txSource: 'node_mempool' })
})

it('records no source for a statement with only exchange accounts', async () => {
  const { service, input } = await setupTwoExchangeAccounts()
  const id = (await service.create(input)).unwrap()

  await expect(service.findById(id)).resolves.toMatchObject({ txSource: null })
})
