import { expect, it, onTestFinished, vi } from 'vitest'
import { accounts, balanceSnapshots, etfAccounts, investmentValuations, manualAccounts } from '../../db/schema'
import { setupAppCaller } from '../trpc/ownership.fixtures'

const initial = {
  displayName: 'Treasury stocks',
  valueCents: '1200000',
  valuedAt: '2026-10-01',
  note: 'Brokerage total',
}

it('creates a USD account and preserves history when adding older and newer valuations', async () => {
  const { caller, db } = await setupAppCaller()
  const api = caller.portalProve.investments
  const accountId = await api.create(initial)
  await api.saveValuation({ accountId, valueCents: '1350000', valuedAt: '2026-11-01' })
  await api.saveValuation({ accountId, valueCents: '900000', valuedAt: '2026-09-01' })
  const account = await api.get({ accountId })
  expect(account).toMatchObject({
    displayName: initial.displayName,
    currency: 'USD',
    valueCents: '1350000',
    valuedAt: '2026-11-01',
  })
  expect(account.valuations.map((row) => row.valueCents)).toEqual(['1350000', '1200000', '900000'])
  expect(account.valuations[1]?.note).toBe('Brokerage total')
  await expect(api.list()).resolves.toMatchObject([{ id: accountId, valueCents: '1350000' }])
  // A manual USD valuation must not become any Bitcoin account or balance snapshot.
  await expect(db.select().from(accounts)).resolves.toEqual([])
  await expect(db.select().from(manualAccounts)).resolves.toEqual([])
  await expect(db.select().from(etfAccounts)).resolves.toEqual([])
  await expect(db.select().from(balanceSnapshots)).resolves.toEqual([])
})

it('edits explicitly, prevents duplicate dates, and derives the current value again after deletion', async () => {
  const { caller } = await setupAppCaller()
  const api = caller.portalProve.investments
  const accountId = await api.create(initial)
  const original = (await api.get({ accountId })).valuations[0]
  expect(original).toBeDefined()
  await api.saveValuation({ accountId, valueCents: '1350000', valuedAt: '2026-11-01' })
  await expect(api.saveValuation({ accountId, valueCents: '2', valuedAt: initial.valuedAt })).rejects.toThrow(
    'already exists',
  )
  await api.saveValuation({
    accountId,
    id: original?.id,
    valueCents: '1250050',
    valuedAt: initial.valuedAt,
    note: 'Corrected',
  })
  const latest = (await api.get({ accountId })).valuations[0]
  await api.deleteValuation({ accountId, id: latest?.id ?? '' })
  await expect(api.get({ accountId })).resolves.toMatchObject({
    valueCents: '1250050',
    valuedAt: initial.valuedAt,
    valuations: [{ note: 'Corrected' }],
  })
  await expect(api.deleteValuation({ accountId, id: original?.id ?? '' })).rejects.toThrow('Keep at least one')
  await api.rename({ accountId, displayName: 'Preferred shares' })
  await expect(api.get({ accountId })).resolves.toMatchObject({ displayName: 'Preferred shares' })
})

it('does not edit or delete valuations belonging to another account and cascades account deletion', async () => {
  const { caller, db } = await setupAppCaller()
  const api = caller.portalProve.investments
  const first = await api.create(initial)
  const second = await api.create({ ...initial, displayName: 'Other fund' })
  const foreign = (await api.get({ accountId: second })).valuations[0]?.id ?? ''
  await expect(
    api.saveValuation({ accountId: first, id: foreign, valueCents: '1', valuedAt: initial.valuedAt }),
  ).rejects.toThrow('Valuation not found')
  await expect(api.deleteValuation({ accountId: first, id: foreign })).rejects.toThrow('Valuation not found')
  await api.delete({ accountId: first })
  await expect(db.select().from(investmentValuations)).resolves.toMatchObject([{ accountId: second }])
  await expect(api.get({ accountId: first })).rejects.toThrow('not found')
})

it.each(['-100', '1.5', 'NaN', 'Infinity', '9007199254740992', '1e6', ''])(
  'rejects invalid cents: %s',
  async (valueCents) => {
    const { caller } = await setupAppCaller()
    await expect(caller.portalProve.investments.create({ ...initial, valueCents })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  },
)

it.each(['2026-02-30', '2026-13-01', '2026-1-01', 'invalid'])(
  'rejects invalid calendar dates: %s',
  async (valuedAt) => {
    const { caller } = await setupAppCaller()
    await expect(caller.portalProve.investments.create({ ...initial, valuedAt })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  },
)

it('stores zero and the largest permitted value exactly and rejects simultaneous date duplicates', async () => {
  const { caller } = await setupAppCaller()
  const api = caller.portalProve.investments
  const accountId = await api.create({ ...initial, valueCents: '0' })
  const results = await Promise.allSettled(
    [0, 1].map(async () => api.saveValuation({ accountId, valueCents: '9007199254740991', valuedAt: '2026-11-02' })),
  )
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'BAD_REQUEST', message: 'A valuation already exists for this date. Edit that valuation instead.' },
  })
  const account = await api.get({ accountId })
  expect(account.valueCents).toBe('9007199254740991')
  expect(account.valuations.map((row) => row.valueCents)).toEqual(['9007199254740991', '0'])
})

it('investment writes and deletion cannot change Bitcoin accounts even when account IDs coincide', async () => {
  const { caller, db } = await setupAppCaller()
  const api = caller.portalProve.investments
  const accountId = await api.create(initial)
  await db.insert(accounts).values({
    id: accountId,
    descriptor: 'synthetic-public-descriptor',
    displayName: 'Verified wallet',
    status: 'verified',
  })
  await db.insert(balanceSnapshots).values({ accountId, timestamp: '2026-10-01', balanceSats: '100000000' })
  await db.insert(manualAccounts).values({ id: accountId, displayName: 'Manual Bitcoin', balanceSats: '200000000' })
  await db.insert(etfAccounts).values({ id: accountId, displayName: 'Bitcoin ETF' })
  const before = await Promise.all([
    db.select().from(accounts),
    db.select().from(balanceSnapshots),
    db.select().from(manualAccounts),
    db.select().from(etfAccounts),
  ])
  await api.saveValuation({ accountId, valueCents: '1350000', valuedAt: '2026-11-01' })
  await api.rename({ accountId, displayName: 'Preferred shares' })
  await api.delete({ accountId })
  const after = await Promise.all([
    db.select().from(accounts),
    db.select().from(balanceSnapshots),
    db.select().from(manualAccounts),
    db.select().from(etfAccounts),
  ])
  expect(after).toEqual(before)
})

it('accepts today and tomorrow for time-zone slack, and rejects later dates on create and save', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-03T23:30:00Z'))
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const { caller } = await setupAppCaller()
  const api = caller.portalProve.investments
  const accountId = await api.create({ ...initial, valuedAt: '2026-11-03' })
  await api.saveValuation({ accountId, valueCents: '100', valuedAt: '2026-11-04' })
  const id = (await api.get({ accountId })).valuations[0]?.id ?? ''
  await expect(api.create({ ...initial, valuedAt: '2026-11-05' })).rejects.toThrow('more than one day ahead')
  await expect(api.saveValuation({ accountId, valueCents: '100', valuedAt: '2026-11-05' })).rejects.toThrow(
    'more than one day ahead',
  )
  await expect(api.saveValuation({ accountId, id, valueCents: '100', valuedAt: '2026-11-05' })).rejects.toThrow(
    'more than one day ahead',
  )
  await expect(api.get({ accountId })).resolves.toMatchObject({ valuedAt: '2026-11-04', valueCents: '100' })
})

it('charts the total reported value on each date, carrying accounts forward and combining same-day updates', async () => {
  const { caller } = await setupAppCaller()
  const api = caller.portalProve.investments
  await expect(api.history()).resolves.toEqual([])
  const first = await api.create({ ...initial, valueCents: '10001' })
  const second = await api.create({
    ...initial,
    displayName: 'Preferred shares',
    valueCents: '20002',
    valuedAt: '2026-10-10',
  })
  await api.saveValuation({ accountId: first, valueCents: '15003', valuedAt: '2026-10-20' })
  await api.saveValuation({ accountId: second, valueCents: '25004', valuedAt: '2026-10-20' })
  await expect(api.history()).resolves.toEqual([
    { valuedAt: '2026-10-01', valueCents: '10001' },
    { valuedAt: '2026-10-10', valueCents: '30003' },
    { valuedAt: '2026-10-20', valueCents: '40007' },
  ])
  const latest = (await api.get({ accountId: first })).valuations[0]
  await api.saveValuation({ accountId: first, id: latest?.id, valueCents: '0', valuedAt: '2026-10-20' })
  expect((await api.history()).at(-1)).toEqual({ valuedAt: '2026-10-20', valueCents: '25004' })
  await api.deleteValuation({ accountId: first, id: latest?.id ?? '' })
  expect((await api.history()).at(-1)).toEqual({ valuedAt: '2026-10-20', valueCents: '35005' })
  await api.delete({ accountId: second })
  await expect(api.history()).resolves.toEqual([{ valuedAt: '2026-10-01', valueCents: '10001' }])
})
