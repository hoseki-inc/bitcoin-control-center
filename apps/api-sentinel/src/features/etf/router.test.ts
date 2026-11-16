import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok, asyncFn } from '@hoseki/packages/result'
import pino from 'pino'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createAppContext } from '../../context'
import * as env from '../../env'
import { appRouter } from '../../modules/trpc/router'

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-etf-router-'))
  vi.stubEnv('DATA_DIR', directory)
  vi.stubEnv('ELECTRUM_HOST', 'localhost')
  vi.spyOn(env, 'loadEnv').mockReturnValue({ ...env.loadEnv(), DATA_DIR: directory })
  vi.spyOn(ElectrumClient.prototype, 'connect').mockImplementation(asyncFn(async () => Ok(['test', '1.4'])))
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  })
  const app = (await createAppContext(pino({ level: 'silent' }), {})).unwrap()
  onTestFinished(() => {
    app.database.$client.close()
    app.electrumClient.disconnect()
  })
  return appRouter.createCaller({ app }).portalProve.etf
}

it('serves every ETF procedure at portalProve.etf', async () => {
  const etf = await setup()

  const created = await etf.create({
    displayName: 'Brokerage',
    holdings: [{ ticker: 'IBIT', shares: '100', datePurchased: '2026-01-05T17:00:00.000Z' }],
  })
  expect(created).toMatchObject({ displayName: 'Brokerage', currency: 'BTC' })
  expect(BigInt(created.balance)).toBeGreaterThan(0n)
  await expect(etf.list()).resolves.toEqual([created])
  await expect(etf.get({ accountId: created.id })).resolves.toEqual(created)

  await etf.rename({ accountId: created.id, displayName: 'Taxable brokerage' })
  await expect(etf.get({ accountId: created.id })).resolves.toMatchObject({ displayName: 'Taxable brokerage' })

  const added = await etf.holdings.add({ accountId: created.id, ticker: 'FBTC', shares: '20' })
  expect((await etf.holdings.list({ accountId: created.id })).map(({ ticker, shares }) => [ticker, shares])).toEqual([
    ['IBIT', '100'],
    ['FBTC', '20'],
  ])
  await etf.holdings.remove({ holdingId: added.id })
  await expect(etf.holdings.list({ accountId: created.id })).resolves.toHaveLength(1)
  await expect(etf.holdings.remove({ holdingId: added.id })).rejects.toThrow('ETF holding not found')

  await etf.delete({ accountId: created.id })
  await expect(etf.list()).resolves.toEqual([])
  await expect(etf.get({ accountId: created.id })).rejects.toThrow('ETF account not found')
  await expect(etf.delete({ accountId: created.id })).rejects.toThrow('ETF account not found')
})
