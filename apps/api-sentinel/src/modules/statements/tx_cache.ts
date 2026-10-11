import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { SentinelDb } from '../../db/drizzle'
import { statementTxCache } from '../../db/schema'
import type { LookedUpTx, TxSourceKind } from './sources/types'

/** Keeps each query well under SQLite's bound-parameter limit. */
const READ_CHUNK_SIZE = 500

const OutputSchema = z.object({ address: z.string().nullable(), value: z.number().int() })
const InputsSchema = z.array(
  z.object({
    spends: z.object({ txid: z.string(), vout: z.number().int() }).nullable(),
    prevout: OutputSchema.nullable(),
  }),
)
const OutputsSchema = z.array(OutputSchema)

/** A lookup that can be saved: it has the block it confirmed in. */
export interface SavedTx extends LookedUpTx {
  blockHeight: number
  blockTime: number
}

/** A saved row as a lookup, or null when it no longer parses. */
function readSaved(row: typeof statementTxCache.$inferSelect): SavedTx | null {
  try {
    // SAFETY: Saved JSON is untrusted until the schema validates it.
    const inputs = parseUnknown(InputsSchema, JSON.parse(row.inputs) as unknown)
    // SAFETY: Saved JSON is untrusted until the schema validates it.
    const outputs = parseUnknown(OutputsSchema, JSON.parse(row.outputs) as unknown)
    if (inputs.isErr() || outputs.isErr()) {
      return null
    }
    return {
      txid: row.txid,
      blockHeight: row.blockHeight,
      blockTime: row.blockTime,
      inputs: inputs.unwrap(),
      outputs: outputs.unwrap(),
    }
  } catch {
    return null
  }
}

/** Confirmed transaction lookups saved locally, shared by every source. */
export class TransactionCache {
  private readonly db: SentinelDb

  public constructor(db: SentinelDb) {
    this.db = db
  }

  /** Saved lookups for these txids. A row that no longer parses is left out, so it's looked up again. */
  public async find(txids: readonly string[]): Promise<Map<string, SavedTx>> {
    const found = new Map<string, SavedTx>()
    for (let i = 0; i < txids.length; i += READ_CHUNK_SIZE) {
      const rows = await this.db
        .select()
        .from(statementTxCache)
        .where(inArray(statementTxCache.txid, txids.slice(i, i + READ_CHUNK_SIZE)))
      for (const row of rows) {
        const saved = readSaved(row)
        if (saved !== null) {
          found.set(row.txid, saved)
        }
      }
    }
    return found
  }

  public async save(tx: SavedTx, source: TxSourceKind): Promise<void> {
    const values = {
      source,
      blockHeight: tx.blockHeight,
      blockTime: tx.blockTime,
      inputs: JSON.stringify(tx.inputs),
      outputs: JSON.stringify(tx.outputs),
    }
    await this.db
      .insert(statementTxCache)
      .values({ txid: tx.txid, ...values })
      .onConflictDoUpdate({ target: statementTxCache.txid, set: { ...values, savedAt: sql`datetime('now')` } })
  }
}
