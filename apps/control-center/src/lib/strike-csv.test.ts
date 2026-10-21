import { describe, expect, it } from 'vitest'
import { type ParsedStrikeTx, STRIKE_REVERSAL_MESSAGE, parseStrikeCsv } from './strike-csv'

const ACTIVITY_HEADER =
  'Transaction ID,Time (UTC),Status,Transaction Type,Amount USD,Fee USD,Amount BTC,Fee BTC,Description,Exchange Rate,Transaction Hash'
const DOCUMENTS_HEADER =
  'Reference,Date & Time (UTC),Transaction Type,Amount USD,Fee USD,Amount BTC,Fee BTC,BTC Price,Cost Basis (USD),Destination,Description,Transaction Hash,Note'

function csv(...lines: string[]): string {
  return lines.join('\r\n') + '\r\n'
}

function parsed(text: string): ParsedStrikeTx[] {
  return parseStrikeCsv(text).expect('Expected the CSV to parse')
}

describe('parseStrikeCsv', () => {
  it('parses Activity and Documents exports of the same rows identically', () => {
    const activity = csv(
      ACTIVITY_HEADER,
      'tx-1,Sep 01 2026 00:12:01,Completed,Purchase,-5.00,,0.00006000,,,80000.00,',
      'tx-2,Sep 23 2026 15:44:29,Completed,Send,,,-0.00100000,0.00000500,To cold storage,,abc123',
    )
    const documents = csv(
      DOCUMENTS_HEADER,
      'tx-1,Sep 01 2026 00:12:01,Purchase,-5.00,,0.00006000,,80000.00,5.00,,,,',
      'tx-2,Sep 23 2026 15:44:29,Send,,,-0.00100000,0.00000500,,,bc1qdestination,To cold storage,abc123,',
    )

    const expected = [
      {
        externalId: 'tx-1',
        transactedAt: '2026-09-01T00:12:01.000Z',
        type: 'purchase',
        amountBtc: '0.00006000',
        amountUsd: '-5.00',
        feeUsd: undefined,
        feeBtc: undefined,
        exchangeRate: '80000.00',
        description: undefined,
        txHash: undefined,
        statementMonth: '2026-09',
      },
      {
        externalId: 'tx-2',
        transactedAt: '2026-09-23T15:44:29.000Z',
        type: 'send',
        amountBtc: '-0.00100000',
        amountUsd: undefined,
        feeUsd: undefined,
        feeBtc: '0.00000500',
        exchangeRate: undefined,
        description: 'To cold storage',
        txHash: 'abc123',
        statementMonth: '2026-09',
      },
    ]
    expect(parsed(activity)).toEqual(expected)
    expect(parsed(documents)).toEqual(expected)
  })

  it('keeps only completed Activity rows, including dropping both halves of a reversal', () => {
    const activity = csv(
      ACTIVITY_HEADER,
      'tx-1,Sep 01 2026 00:12:01,Completed,Purchase,-5.00,,0.00006000,,,80000.00,',
      'tx-2,Sep 02 2026 00:12:01,Reversed,Receive,,,0.00010000,,,,',
      'tx-2,Sep 02 2026 00:12:05,Reversed,Receive,,,-0.00010000,,,,',
      'tx-3,Sep 03 2026 00:12:01,Pending,Purchase,-5.00,,0.00006000,,,80000.00,',
    )
    expect(parsed(activity).map((tx) => tx.externalId)).toEqual(['tx-1'])
  })

  it('refuses a Documents export where two Bitcoin rows share an ID', () => {
    const documents = csv(
      DOCUMENTS_HEADER,
      'tx-2,Sep 02 2026 00:12:01,Receive,,,0.00010000,,,,,,,',
      'tx-2,Sep 02 2026 00:12:05,Receive,,,-0.00010000,,,,,,,',
    )
    expect(parseStrikeCsv(documents).unwrapErr()?.message).toBe(STRIKE_REVERSAL_MESSAGE)
  })

  it('ignores USD-only rows that share an ID', () => {
    const documents = csv(
      DOCUMENTS_HEADER,
      'usd-1,Sep 10 2026 17:07:56,Deposit,50.00,,,,,,,,,',
      'usd-1,Sep 10 2026 17:08:03,Deposit,-50.00,,,,,,,,,',
      'tx-1,Sep 11 2026 00:12:01,Purchase,-5.00,,0.00006000,,80000.00,5.00,,,,',
    )
    expect(parsed(documents).map((tx) => tx.externalId)).toEqual(['tx-1'])
  })

  it('does not keep a carriage return on the last column', () => {
    const activity = csv(ACTIVITY_HEADER, 'tx-1,Sep 01 2026 00:12:01,Completed,Send,,,-0.00100000,,,,abc123')
    expect(parsed(activity)[0]?.txHash).toBe('abc123')
  })

  it('skips rows with an invalid date or no Bitcoin amount', () => {
    const activity = csv(
      ACTIVITY_HEADER,
      'tx-1,not a date,Completed,Purchase,-5.00,,0.00006000,,,80000.00,',
      'tx-2,Sep 01 2026 00:12:01,Completed,Deposit,100.00,,,,,,',
    )
    expect(parsed(activity)).toEqual([])
  })

  it.each([
    ['an unrecognized header', csv('Date,Amount,Note', 'Sep 01 2026,0.1,hello')],
    ['an Activity header without Status', csv(ACTIVITY_HEADER.replace('Status,', ''))],
    ['an empty file', ''],
  ])('yields no rows for %s', (_, text) => {
    expect(parsed(text)).toEqual([])
  })
})
