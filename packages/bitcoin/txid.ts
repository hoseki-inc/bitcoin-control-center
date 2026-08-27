import { z } from 'zod'
import { type Result, parse } from '../result'

export const TxidSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand('Txid')

/** Transaction ID in the Bitcoin network, hex-encoded 32-byte hash. */
export type Txid = z.infer<typeof TxidSchema>

export namespace Txid {
  export function fromString(txid: string): Result<Txid, Error> {
    return parse(TxidSchema, txid)
  }

  export function fromBuffer(buf: Buffer): Result<Txid, Error> {
    return Txid.fromString(buf.toString('hex'))
  }
}
