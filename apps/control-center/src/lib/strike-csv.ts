import { Err, Ok, type Result } from '@hoseki/packages/result'

export interface ParsedStrikeTx {
  externalId: string
  transactedAt: string
  type: string
  amountBtc: string
  amountUsd?: string
  feeUsd?: string
  feeBtc?: string
  exchangeRate?: string
  description?: string
  txHash?: string
  statementMonth: string
}

export const STRIKE_REVERSAL_MESSAGE =
  'This statement includes a reversed transaction. Use Activity → Generate Report in Strike and upload that CSV instead.'

/**
 * Parse a Strike CSV from either Activity → Generate Report (has `Status`) or
 * Documents → Export as CSV (no `Status`). An unrecognized header yields no rows.
 */
export function parseStrikeCsv(csvText: string): Result<ParsedStrikeTx[], Error> {
  const lines = csvText.trim().split(/\r?\n/)
  const header = parseCsvLine(lines[0] ?? '')
  const column = (...names: string[]): number => header.findIndex((name) => names.includes(name))

  const idCol = column('Transaction ID', 'Reference')
  const timeCol = column('Time (UTC)', 'Date & Time (UTC)')
  const typeCol = column('Transaction Type')
  const amountBtcCol = column('Amount BTC')
  const statusCol = column('Status')
  // Activity exports have Status; only the Documents layout may omit it.
  const isDocuments = header[idCol] === 'Reference'
  if (idCol < 0 || timeCol < 0 || typeCol < 0 || amountBtcCol < 0 || (statusCol < 0 && !isDocuments)) {
    return Ok([])
  }
  const cols = {
    amountUsd: column('Amount USD'),
    feeUsd: column('Fee USD'),
    feeBtc: column('Fee BTC'),
    exchangeRate: column('Exchange Rate', 'BTC Price'),
    description: column('Description'),
    txHash: column('Transaction Hash'),
  }

  const transactions: ParsedStrikeTx[] = []
  const seenIds = new Set<string>()

  for (const line of lines.slice(1)) {
    if (line === '') {
      continue
    }
    const row = parseCsvLine(line)
    const value = (index: number): string => (index < 0 ? '' : (row[index]?.trim() ?? ''))
    const optional = (index: number): string | undefined => {
      const text = value(index)
      return text === '' ? undefined : text
    }

    if (statusCol >= 0 && value(statusCol) !== 'Completed') {
      continue
    }
    const txId = value(idCol)
    const timeUtc = value(timeCol)
    const txType = value(typeCol)
    const amountBtc = value(amountBtcCol)
    if (txId === '' || timeUtc === '' || txType === '' || amountBtc === '') {
      continue
    }

    const date = new Date(timeUtc + ' UTC')
    if (isNaN(date.getTime())) {
      continue
    }

    // Strike gives both halves of a reversal the same ID. Without Status we can't
    // tell them apart, and importing would keep only one half.
    if (seenIds.has(txId)) {
      return Err(new Error(STRIKE_REVERSAL_MESSAGE))
    }
    seenIds.add(txId)

    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')

    transactions.push({
      externalId: txId,
      transactedAt: date.toISOString(),
      type: txType.toLowerCase(),
      amountBtc,
      amountUsd: optional(cols.amountUsd),
      feeUsd: optional(cols.feeUsd),
      feeBtc: optional(cols.feeBtc),
      exchangeRate: optional(cols.exchangeRate),
      description: optional(cols.description),
      txHash: optional(cols.txHash),
      statementMonth: `${year}-${month}`,
    })
  }

  return Ok(transactions)
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}
