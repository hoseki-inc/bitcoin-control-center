import { TZDate } from '@date-fns/tz'
import { convertBtcToUsd } from '@hoseki/packages/currency'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import type {
  Amount,
  BalanceEntry,
  PdfStatement,
  StatementDocumentFormat,
  StatementEntry,
  StatementId,
  StatementPeriodData,
  StatementTransaction,
  Summary,
  SummaryEntry,
  Timezone,
} from '@hoseki/packages/schemas'
import { eachMonthOfInterval, endOfMonth } from 'date-fns'
import Decimal from 'decimal.js'
import type { DailyRate, DailyRates } from '../price/daily_rates'
import { toDateKey } from '../price/daily_rates'

// ─── AggregatedTransaction ──────────────────────────────────────────────────

export interface AggregatedTransaction {
  address: string
  hash: string
  balanceChange: bigint
  block: number | null
  transactedAt: Date
  confirmed: boolean
  accountName: string
}

// ─── Completed Statement (in-memory representation) ─────────────────────────

export interface CompletedStatementData {
  id: string
  createdAt: Date
  status: 'completed'
  counter: number
  timezone: string
  openingDate: Date
  closingDate: Date
  user: { email: string | null; name: string | null; address: string | null }
  transactionMap: Record<string, AggregatedTransaction[]>
  dailyRates: DailyRates
}

// ─── PdfStatement Factory ───────────────────────────────────────────────────

function createPdfStatement(
  args: {
    id: string
    createdAt: Date
    status: 'completed'
    counter: number
    timezone: string
    user: { email: string | null; name: string | null; address: string | null }
  } & (
    | { format: 'custom'; summary: Summary; statementEntries: StatementEntry[] }
    | { format: 'monthly'; months: StatementPeriodData[] }
  ),
): PdfStatement {
  const common = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PDF previews intentionally use preview_ IDs; preserve the existing non-persisted identifier format.
    id: args.id as StatementId,
    createdAt: args.createdAt,
    status: args.status,
    counter: args.counter,
    timezone: args.timezone,
    currency: 'BTC' as const,
    user: args.user,
  }

  switch (args.format) {
    case 'custom':
      return {
        ...common,
        format: 'custom',
        summary: args.summary,
        statementEntries: args.statementEntries,
      }
    case 'monthly':
      return {
        ...common,
        format: 'monthly',
        months: args.months,
      }
  }
}

// ─── StatementMapper ────────────────────────────────────────────────────────

export class StatementMapper {
  public toPdfStatement(
    statement: CompletedStatementData,
    format: StatementDocumentFormat,
  ): Result<PdfStatement, Error> {
    switch (format) {
      case 'custom':
        return this.createCustomPdfStatement(statement)
      case 'monthly':
        return this.createMonthlyPdfStatement(statement)
    }
  }

  private readonly createCustomPdfStatement = (statement: CompletedStatementData): Result<PdfStatement, Error> => {
    const aggregatedRes = this.aggregateStatementData(
      statement.openingDate,
      statement.closingDate,
      statement.transactionMap,
      statement.dailyRates,
    )
    if (aggregatedRes.isErr()) {
      return Err(aggregatedRes.unwrapErr())
    }
    const agg = aggregatedRes.unwrap()

    return Ok(
      createPdfStatement({
        format: 'custom',
        id: statement.id,
        createdAt: statement.createdAt,
        status: statement.status,
        counter: statement.counter,
        timezone: statement.timezone,
        user: statement.user,
        summary: {
          openingDate: agg.openingDate,
          closingDate: agg.closingDate,
          openingBalance: agg.openingBalance,
          closingBalance: agg.closingBalance,
          moneyIn: agg.moneyIn,
          moneyOut: agg.moneyOut,
          entries: agg.entries,
        },
        statementEntries: agg.statements,
      }),
    )
  }

  private readonly createMonthlyPdfStatement = (statement: CompletedStatementData): Result<PdfStatement, Error> => {
    const monthlyData = this.createMonthlyData(statement, statement.timezone)
    if (monthlyData.isErr()) {
      return Err(monthlyData.unwrapErr())
    }

    return Ok(
      createPdfStatement({
        format: 'monthly',
        id: statement.id,
        createdAt: statement.createdAt,
        status: statement.status,
        counter: statement.counter,
        timezone: statement.timezone,
        user: statement.user,
        months: monthlyData.unwrap(),
      }),
    )
  }

  private aggregateStatementData(
    openingDate: Date,
    closingDate: Date,
    transactionMap: Record<string, AggregatedTransaction[]>,
    dailyRates: { rates: Record<string, DailyRate>; source: string },
  ): Result<Summary & { statements: StatementEntry[] }, Error> {
    const statementEntries: StatementEntry[] = []
    const summaryEntries: SummaryEntry[] = []

    const openingKey = toDateKey(openingDate)
    const closingKey = toDateKey(closingDate)
    const openingRate = dailyRates.rates[openingKey]
    const closingRate = dailyRates.rates[closingKey]

    if (!openingRate) {
      return Err(new Error(`No daily rate for opening date ${openingKey}`))
    }
    if (!closingRate) {
      return Err(new Error(`No daily rate for closing date ${closingKey}`))
    }

    let totalOpeningBalance: Amount = {
      sats: 0n,
      usdValue: new Decimal(0),
      rate: openingRate.close,
      timestamp: openingRate.timestamp,
      provider: dailyRates.source,
    }
    let totalClosingBalance: Amount = {
      sats: 0n,
      usdValue: new Decimal(0),
      rate: closingRate.close,
      timestamp: closingRate.timestamp,
      provider: dailyRates.source,
    }
    let totalMoneyIn: Amount = {
      sats: 0n,
      usdValue: new Decimal(0),
      rate: openingRate.close,
      timestamp: openingRate.timestamp,
      provider: dailyRates.source,
    }
    let totalMoneyOut: Amount = {
      sats: 0n,
      usdValue: new Decimal(0),
      rate: openingRate.close,
      timestamp: openingRate.timestamp,
      provider: dailyRates.source,
    }

    for (const [accountName, accountTxs] of Object.entries(transactionMap)) {
      let currentBalance = 0n
      let openingBalance = 0n
      let moneyIn: Amount = {
        sats: 0n,
        usdValue: new Decimal(0),
        rate: openingRate.close,
        timestamp: openingRate.timestamp,
        provider: dailyRates.source,
      }
      let moneyOut: Amount = {
        sats: 0n,
        usdValue: new Decimal(0),
        rate: openingRate.close,
        timestamp: openingRate.timestamp,
        provider: dailyRates.source,
      }
      const statementTxs: StatementTransaction[] = []

      for (const tx of accountTxs) {
        if (tx.transactedAt > closingDate) {
          continue
        }

        currentBalance += tx.balanceChange

        if (tx.transactedAt < openingDate) {
          openingBalance = currentBalance
          totalOpeningBalance.sats += tx.balanceChange
        } else {
          const txDate = toDateKey(tx.transactedAt)
          const dailyRate = dailyRates.rates[txDate]
          if (!dailyRate) {
            return Err(new Error(`No daily rate for transaction date ${txDate}`))
          }

          const changeUsd = convertBtcToUsd(tx.balanceChange, dailyRate.close)
          const balanceUsd = convertBtcToUsd(currentBalance, dailyRate.close)

          if (tx.balanceChange > 0n) {
            moneyIn.sats += tx.balanceChange
            moneyIn.usdValue = moneyIn.usdValue.plus(changeUsd)
            totalMoneyIn.sats += tx.balanceChange
          } else {
            moneyOut.sats += tx.balanceChange
            moneyOut.usdValue = moneyOut.usdValue.plus(changeUsd)
            totalMoneyOut.sats += tx.balanceChange
          }

          statementTxs.push({
            date: tx.transactedAt,
            blockHeight: tx.block,
            amount: {
              sats: tx.balanceChange,
              usdValue: changeUsd,
              rate: dailyRate.close,
              timestamp: dailyRate.timestamp,
              provider: dailyRates.source,
            },
            confirmed: tx.confirmed,
            balance: {
              sats: currentBalance,
              usdValue: balanceUsd,
              rate: dailyRate.close,
              timestamp: dailyRate.timestamp,
              provider: dailyRates.source,
            },
          })
        }
      }

      const balanceEntry: BalanceEntry = {
        displayName: accountName,
        openingBalance: {
          sats: openingBalance,
          usdValue: convertBtcToUsd(openingBalance, openingRate.close),
          rate: openingRate.close,
          timestamp: openingRate.timestamp,
          provider: dailyRates.source,
        },
        closingBalance: {
          sats: currentBalance,
          usdValue: convertBtcToUsd(currentBalance, closingRate.close),
          rate: closingRate.close,
          timestamp: closingRate.timestamp,
          provider: dailyRates.source,
        },
        moneyIn: {
          sats: moneyIn.sats,
          usdValue: moneyIn.usdValue,
          rate: openingRate.close,
          timestamp: openingRate.timestamp,
          provider: dailyRates.source,
        },
        moneyOut: {
          sats: moneyOut.sats,
          usdValue: moneyOut.usdValue,
          rate: openingRate.close,
          timestamp: openingRate.timestamp,
          provider: dailyRates.source,
        },
      }

      summaryEntries.push(balanceEntry)
      statementEntries.push({
        ...balanceEntry,
        transactions: statementTxs.sort((a, b) => b.date.getTime() - a.date.getTime()),
      })

      totalClosingBalance.sats += currentBalance
      totalMoneyIn.usdValue = totalMoneyIn.usdValue.plus(balanceEntry.moneyIn.usdValue)
      totalMoneyOut.usdValue = totalMoneyOut.usdValue.plus(balanceEntry.moneyOut.usdValue)
    }

    totalOpeningBalance.usdValue = convertBtcToUsd(totalOpeningBalance.sats, openingRate.close)
    totalClosingBalance.usdValue = convertBtcToUsd(totalClosingBalance.sats, closingRate.close)

    return Ok({
      openingDate,
      closingDate,
      openingBalance: {
        ...totalOpeningBalance,
        rate: openingRate.close,
        timestamp: openingRate.timestamp,
        provider: dailyRates.source,
      },
      closingBalance: {
        ...totalClosingBalance,
        rate: closingRate.close,
        timestamp: closingRate.timestamp,
        provider: dailyRates.source,
      },
      moneyIn: {
        ...totalMoneyIn,
        rate: openingRate.close,
        timestamp: openingRate.timestamp,
        provider: dailyRates.source,
      },
      moneyOut: {
        ...totalMoneyOut,
        rate: openingRate.close,
        timestamp: openingRate.timestamp,
        provider: dailyRates.source,
      },
      entries: summaryEntries,
      statements: statementEntries,
    })
  }

  private createMonthlyData(
    statement: CompletedStatementData,
    timezone: Timezone,
  ): Result<StatementPeriodData[], Error> {
    const tzOpeningDate = new TZDate(statement.openingDate, timezone)
    const tzClosingDate = new TZDate(statement.closingDate, timezone)
    const startOfEachMonth = eachMonthOfInterval({ start: tzOpeningDate, end: tzClosingDate })

    const months: StatementPeriodData[] = []

    for (const [index, startOfMonth] of startOfEachMonth.entries()) {
      const isFirstMonth = index === 0
      const isLastMonth = index === startOfEachMonth.length - 1
      const monthOpeningDate = isFirstMonth ? tzOpeningDate : startOfMonth
      const monthClosingDate = isLastMonth ? tzClosingDate : endOfMonth(startOfMonth)

      const aggregatedMonthRes = this.aggregateStatementData(
        monthOpeningDate.withTimeZone('UTC'),
        monthClosingDate.withTimeZone('UTC'),
        statement.transactionMap,
        statement.dailyRates,
      )
      if (aggregatedMonthRes.isErr()) {
        return Err(aggregatedMonthRes.unwrapErr())
      }
      const agg = aggregatedMonthRes.unwrap()

      const entriesWithTotal = agg.entries.concat([
        {
          displayName: 'Total',
          openingBalance: agg.openingBalance,
          closingBalance: agg.closingBalance,
          moneyIn: agg.moneyIn,
          moneyOut: agg.moneyOut,
        },
      ])

      months.push({
        summary: {
          openingDate: monthOpeningDate,
          closingDate: monthClosingDate,
          openingBalance: agg.openingBalance,
          closingBalance: agg.closingBalance,
          moneyIn: agg.moneyIn,
          moneyOut: agg.moneyOut,
          entries: entriesWithTotal,
        },
        statementEntries: agg.statements,
      })
    }

    return Ok(months)
  }
}
