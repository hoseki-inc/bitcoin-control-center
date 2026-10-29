import { MAX_TRANSACTION_INPUTS, MAX_TRANSACTION_OUTPUTS } from '@hoseki/packages/bitcoin/limits'
import { z } from 'zod'

export const MAX_ELECTRUM_RESPONSE_BYTES = 16 * 1024 * 1024
export const MAX_ELECTRUM_LIST_ITEMS = MAX_ELECTRUM_RESPONSE_BYTES / 64

// ─── Electrum JSON-RPC Protocol ───────────────────────────────────────────────

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.array(z.unknown()).max(MAX_ELECTRUM_LIST_ITEMS),
  id: z.number(),
})
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>

export const JsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
})
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number().nullable(),
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
})
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>

// ─── Electrum Method Responses ────────────────────────────────────────────────

/** Response from `server.version` */
export const ServerVersionSchema = z.tuple([z.string(), z.string()])
export type ServerVersion = z.infer<typeof ServerVersionSchema>

/** Response from `blockchain.headers.subscribe` */
export const HeaderNotificationSchema = z.object({
  height: z.number(),
  hex: z.string(),
})
export type HeaderNotification = z.infer<typeof HeaderNotificationSchema>

/** Response from `blockchain.scripthash.get_balance` */
export const ScripthashBalanceSchema = z.object({
  confirmed: z.number(),
  unconfirmed: z.number(),
})
export type ScripthashBalance = z.infer<typeof ScripthashBalanceSchema>

/** Single entry from `blockchain.scripthash.get_history` */
export const ScripthashHistoryEntrySchema = z.object({
  tx_hash: z.string(),
  height: z.number(),
  fee: z.number().optional(),
})
export type ScripthashHistoryEntry = z.infer<typeof ScripthashHistoryEntrySchema>

/** Response from `blockchain.scripthash.get_history` */
export const ScripthashHistorySchema = z.array(ScripthashHistoryEntrySchema).max(MAX_ELECTRUM_LIST_ITEMS)
export type ScripthashHistory = z.infer<typeof ScripthashHistorySchema>

/** Single entry from `blockchain.scripthash.listunspent` */
export const ScripthashUnspentEntrySchema = z.object({
  tx_hash: z.string(),
  tx_pos: z.number(),
  height: z.number(),
  value: z.number(),
})
export type ScripthashUnspentEntry = z.infer<typeof ScripthashUnspentEntrySchema>

/** Response from `blockchain.scripthash.listunspent` */
export const ScripthashUnspentSchema = z.array(ScripthashUnspentEntrySchema).max(MAX_ELECTRUM_LIST_ITEMS)
export type ScripthashUnspent = z.infer<typeof ScripthashUnspentSchema>

/** Input from verbose `blockchain.transaction.get` */
export const ElectrumTxInputSchema = z.object({
  txid: z.string(),
  vout: z.number(),
  scriptSig: z
    .object({
      asm: z.string().optional(),
      hex: z.string().optional(),
    })
    .optional(),
  txinwitness: z.array(z.string()).max(MAX_ELECTRUM_LIST_ITEMS).optional(),
  sequence: z.number(),
  // Electrs provides prevout data inline; Fulcrum may not
  prevout: z
    .object({
      scriptPubKey: z.object({
        address: z.string().optional(),
      }),
      value: z.number(),
    })
    .optional(),
})
export type ElectrumTxInput = z.infer<typeof ElectrumTxInputSchema>

/** Output from verbose `blockchain.transaction.get` */
export const ElectrumTxOutputSchema = z.object({
  value: z.number(),
  n: z.number(),
  scriptPubKey: z.object({
    asm: z.string().optional(),
    hex: z.string().optional(),
    type: z.string().optional(),
    address: z.string().optional(),
    // Some responses use 'addresses' array instead of single 'address'
    addresses: z.array(z.string()).max(MAX_ELECTRUM_LIST_ITEMS).optional(),
  }),
})
export type ElectrumTxOutput = z.infer<typeof ElectrumTxOutputSchema>

/** Response from verbose `blockchain.transaction.get` */
export const ElectrumVerboseTransactionSchema = z.object({
  txid: z.string(),
  hash: z.string().optional(),
  version: z.number(),
  size: z.number().optional(),
  vsize: z.number().optional(),
  weight: z.number().optional(),
  locktime: z.number(),
  vin: z.array(ElectrumTxInputSchema).max(MAX_TRANSACTION_INPUTS),
  vout: z.array(ElectrumTxOutputSchema).max(MAX_TRANSACTION_OUTPUTS),
  hex: z.string().optional(),
  blockhash: z.string().optional(),
  confirmations: z.number().optional(),
  time: z.number().optional(),
  blocktime: z.number().optional(),
})
export type ElectrumVerboseTransaction = z.infer<typeof ElectrumVerboseTransactionSchema>

/** Response from `blockchain.block.header` (hex string) */
export const BlockHeaderHexSchema = z.string()
export type BlockHeaderHex = z.infer<typeof BlockHeaderHexSchema>
