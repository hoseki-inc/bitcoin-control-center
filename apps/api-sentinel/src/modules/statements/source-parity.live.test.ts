import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Address } from '@hoseki/packages/bitcoin/address'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import type { TransactionEntry } from '@hoseki/packages/bitcoin/onchain/types'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import pino from 'pino'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { toTransactionEntries } from './entries'
import type { AccountHistory } from './history'
import { lookupTransactions } from './lookup'
import { ElectrumSource } from './sources/electrum'
import { MempoolSource } from './sources/mempool'
import type { TxSource } from './sources/types'

/**
 * Looks up recorded transactions on live public servers and checks both sources still agree.
 * Off by default because it contacts public servers. Run with STATEMENT_LIVE_PARITY=1; set
 * STATEMENT_LIVE_ELECTRUM=host:port:ssl|tcp to use your own Electrum server instead of Blockstream's.
 */
const live = process.env['STATEMENT_LIVE_PARITY'] === '1'
const [host = 'electrum.blockstream.info', port = '50002', protocol = 'ssl'] = (
  process.env['STATEMENT_LIVE_ELECTRUM'] ?? ''
)
  .split(':')
  .filter((part) => part !== '')

const logger = pino({ level: 'silent' })

const RecordingSchema = z.object({
  transactions: z.array(
    z.object({
      label: z.string(),
      parents: z.array(z.string()),
      mempool: z.object({
        txid: z.string(),
        vin: z.array(z.object({ prevout: z.object({ scriptpubkey_address: z.string().optional() }).nullable() })),
        vout: z.array(z.object({ scriptpubkey_address: z.string().optional() })),
        status: z.object({ block_height: z.number() }),
      }),
    }),
  ),
  parents: z.record(z.string(), z.object({ mempool: z.object({ status: z.object({ block_height: z.number() }) }) })),
})

it.runIf(live)(
  'gives the same entries from mempool.space and a live Electrum server for recorded transactions',
  async () => {
    const recording = parseUnknown(
      RecordingSchema,
      JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'mainnet-transactions.json'), 'utf8')),
    ).expect('Recorded transactions must parse')
    const electrum = new ElectrumClient({ host, port: Number(port), protocol: protocol === 'tcp' ? 'tcp' : 'ssl' })
    const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
    ;(await electrum.connect()).expect('The live Electrum server must be reachable')
    try {
      for (const tx of recording.transactions.filter((recorded) => recorded.parents.length <= 4).slice(0, 10)) {
        const addresses = [
          ...new Set([
            ...tx.mempool.vin.flatMap((input) => input.prevout?.scriptpubkey_address ?? []),
            ...tx.mempool.vout.flatMap((output) => output.scriptpubkey_address ?? []),
          ]),
        ].flatMap((address) => Address.fromString(address).unwrapOr([]))
        const heights = new Map([
          [tx.mempool.txid, tx.mempool.status.block_height],
          ...tx.parents.map((id): [string, number] => [id, recording.parents[id]?.mempool.status.block_height ?? 0]),
        ])
        const history: AccountHistory = new Map([...heights].map(([id, height]) => [id, { height, addresses }]))
        const tip = Math.max(...heights.values()) + 100
        const entries = async (source: TxSource): Promise<TransactionEntry[]> => {
          const found = (await lookupTransactions({ transactions: heights, source, logger })).expect('Live lookups')
          return toTransactionEntries(history, found, tip)
            .expect('Live entries')
            .filter((entry) => entry.txid.toString() === tx.mempool.txid)
        }

        const viaMempool = await entries(new MempoolSource('https://mempool.space'))
        const viaElectrum = await entries(new ElectrumSource(onchainProvider))

        expect(viaMempool.length, tx.label).toBeGreaterThan(0)
        expect(viaElectrum, tx.label).toEqual(viaMempool)
      }
    } finally {
      electrum.disconnect()
    }
  },
  300_000,
)
