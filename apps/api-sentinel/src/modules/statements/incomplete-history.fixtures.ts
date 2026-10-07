import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { AsyncErr, AsyncOk, Ok, tryBlock } from '@hoseki/packages/result'
import type { CustomPdfStatement } from '@hoseki/packages/schemas'
import { Wallets } from '@hoseki/packages/testing'
import Decimal from 'decimal.js'
import pino from 'pino'
import { expect, onTestFinished, vi } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../../db/drizzle'
import { accounts } from '../../db/schema'
import { ExchangeService } from '../exchange/service'
import { DailyRatesService } from '../price/daily_rates'
import { StatementMapper } from './mapper'
import { type GenerateStatementInput, StatementService } from './service'

const openingDate = new Date('2024-01-01T00:00:00.000Z')
const closingDate = new Date('2024-01-31T23:59:59.999Z')
const transactionDate = new Date('2024-01-02T12:00:00.000Z')
const period = { openingDate, closingDate, timezone: 'UTC' }
const transactionStatus = { confirmed: true, block_height: 800000, block_time: transactionDate.getTime() / 1000 }
const withdrawalId = 'f'.repeat(64)
export const missingTransactionId = withdrawalId

type WithdrawalOutcome = 'success' | 'HTTP 404' | 'HTTP 503' | 'network rejection' | 'invalid JSON'

interface StatementScenario {
  service: StatementService
  input: GenerateStatementInput
}

function createWallet(account: SingleSigAccount, index: number) {
  return {
    id: `wallet-${index}`,
    account,
    address: account.receiveAddress(0, Network.Mainnet),
    txid: (index + 1).toString().repeat(64),
    value: (index + 1) * 100_000_000,
  }
}

const savingsWallet = createWallet(Wallets.singlesigNativeSegwitAccount, 0)
const spendingWallet = createWallet(Wallets.singlesigNestedSegwitAccount, 1)
const wallets = [savingsWallet, spendingWallet]

async function seedWallet(db: SentinelDb, wallet: (typeof wallets)[number], name: string): Promise<string> {
  await db
    .insert(accounts)
    .values({ id: wallet.id, descriptor: wallet.account.toString(), displayName: name, status: 'verified' })
  return wallet.id
}

async function createStatementHarness(outcome: WithdrawalOutcome) {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-statement-history-'))
  const logger = pino({ level: 'silent' })
  const database = await openDrizzleDatabase(directory, logger)

  onTestFinished(() => {
    database.$client.close()
    rmSync(directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const electrum = new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' })
  const history = vi.spyOn(electrum, 'getHistory').mockImplementation((scripthash: string) =>
    tryBlock(async function* () {
      const wallet = wallets.find(
        (item) => addressToScripthash(item.address).expect('Fixture address must be valid') === scripthash,
      )
      if (wallet === undefined) {
        expect.fail('History request must target a fixture wallet')
      }
      return Ok([{ tx_hash: wallet.txid, height: 800000 }])
    }),
  )

  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(() =>
    AsyncOk({ lastUsedReceiveIndex: 0, lastUsedChangeIndex: -1 }),
  )
  vi.spyOn(onchainProvider, 'getBlocksTip').mockImplementation(() =>
    AsyncOk({ height: 900000, hash: 'tip', timestamp: closingDate }),
  )

  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new Request(input).url
      if (url.endsWith(withdrawalId)) {
        switch (outcome) {
          case 'HTTP 404':
            return new Response('Transaction not found', { status: 404 })
          case 'HTTP 503':
            return new Response('Unavailable', { status: 503 })
          case 'network rejection':
            throw new Error('Synthetic connection reset')
          case 'invalid JSON':
            return new Response('{')
          case 'success':
            return Response.json({
              txid: withdrawalId,
              vin: [{ prevout: { scriptpubkey_address: savingsWallet.address.toString(), value: 25_000_000 } }],
              vout: [],
              status: transactionStatus,
            })
        }
      }

      const wallet = wallets.find((item) => url.endsWith(item.txid))
      if (wallet === undefined) {
        expect.fail('Transaction request must target a fixture transaction')
      }
      return Response.json({
        txid: wallet.txid,
        vin: [{ prevout: null }],
        vout: [{ scriptpubkey_address: wallet.address.toString(), value: wallet.value }],
        status: transactionStatus,
      })
    }),
  )

  const dailyRatesService = new DailyRatesService({ db: database, logger, mempoolApiUrl: 'https://example.invalid' })
  const rate = new Decimal(40_000)
  const rates = Object.fromEntries(
    [openingDate, transactionDate, closingDate].map((date) => [
      date.toISOString().slice(0, 10),
      { timestamp: date, open: rate, high: rate, low: rate, close: rate },
    ]),
  )
  const getDailyRates = vi
    .spyOn(dailyRatesService, 'getDailyRates')
    .mockImplementation(() => AsyncOk({ source: 'mempool' as const, quoteCurrency: 'USD' as const, rates }))

  const service = new StatementService({
    db: database,
    logger,
    onchainProvider,
    mempoolApiUrl: 'https://example.invalid',
    dailyRatesService,
    exchangeService: new ExchangeService({ db: database, logger }),
    // Retries happen without real waits.
    sleep: async () => {},
  })

  return { service, db: database, history, getDailyRates }
}

export async function setupDepositAndWithdrawal(outcome: WithdrawalOutcome): Promise<
  StatementScenario & {
    getDailyRates: Awaited<ReturnType<typeof createStatementHarness>>['getDailyRates']
  }
> {
  const { service, db, history, getDailyRates } = await createStatementHarness(outcome)
  const claimId = await seedWallet(db, savingsWallet, 'Savings')
  history.mockReturnValueOnce(
    AsyncOk([
      { tx_hash: savingsWallet.txid, height: 800000 },
      { tx_hash: withdrawalId, height: 800000 },
    ]),
  )
  return { service, input: { ...period, claimIds: [claimId] }, getDailyRates }
}

export async function setupHistoryFailure(): Promise<
  StatementScenario & {
    getDailyRates: Awaited<ReturnType<typeof createStatementHarness>>['getDailyRates']
  }
> {
  const { service, db, history, getDailyRates } = await createStatementHarness('success')
  const claimIds = [await seedWallet(db, savingsWallet, 'Savings'), await seedWallet(db, spendingWallet, 'Spending')]
  history
    .mockReturnValueOnce(AsyncOk([{ tx_hash: savingsWallet.txid, height: 800000 }]))
    .mockReturnValueOnce(AsyncErr(new Error('Synthetic Electrum history failure')))
  return { service, input: { ...period, claimIds }, getDailyRates }
}

export async function generateStatementPdf({ service, input }: StatementScenario): Promise<CustomPdfStatement> {
  const data = (await service.generateStatementData(input)).expect('Complete history must generate a statement')
  const statement = new StatementMapper()
    .toPdfStatement(
      {
        ...data,
        ...input,
        id: 'statement-test',
        createdAt: closingDate,
        status: 'completed',
        counter: 1,
        user: { email: null, name: null, address: null },
      },
      'custom',
    )
    .expect('Generated data must map to a PDF statement')
  if (statement.format === 'custom') {
    return statement
  }
  return expect.unreachable('Generated statement must use the custom format')
}
