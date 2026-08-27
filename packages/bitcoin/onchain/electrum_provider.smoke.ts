/**
 * Smoke test for ElectrumProvider.
 *
 * Connects to Blockstream's public Electrum server and exercises the full provider
 * flow with a known Bitcoin address (Satoshi's genesis coinbase address).
 *
 * Run: npx tsx packages/bitcoin/onchain/electrum_provider.smoke.ts
 */
import pino from 'pino'
import { ElectrumClient } from '../../clients/electrum'
import { IndexMap, IndexSet } from '../../collection'
import { Address } from '../address'
import { Network } from '../network'
import { ElectrumProvider } from './electrum_provider'

const logger = pino({ level: 'debug', transport: { target: 'pino-pretty' } })

async function main(): Promise<void> {
  // Satoshi's genesis coinbase address - guaranteed to have history
  const satoshiAddress = Address.fromString('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').expect('valid address')

  logger.info('Connecting to Blockstream Electrum server (SSL)...')
  const client = new ElectrumClient({
    host: 'electrum.blockstream.info',
    port: 50002,
    protocol: 'ssl',
  })

  const connectResult = await client.connect()
  if (connectResult.isErr()) {
    logger.error({ error: connectResult.unwrapErr().message }, 'Failed to connect')
    process.exit(1)
  }
  const version = connectResult.unwrap()
  logger.info({ version }, 'Connected and negotiated protocol version')

  const provider = new ElectrumProvider(Network.Mainnet, { logger, electrum: client })

  // 1. Get block tip
  logger.info('--- getBlocksTip ---')
  const tipResult = await provider.getBlocksTip()
  if (tipResult.isErr()) {
    logger.error({ error: tipResult.unwrapErr().message }, 'getBlocksTip failed')
  } else {
    const tip = tipResult.unwrap()
    logger.info({ height: tip.height, hash: tip.hash, timestamp: tip.timestamp.toISOString() }, 'Block tip')
  }

  // 2. Check if address is used
  logger.info('--- areAddressesUsed ---')
  const usedResult = await provider.areAddressesUsed(new IndexSet([satoshiAddress]))
  if (usedResult.isErr()) {
    logger.error({ error: usedResult.unwrapErr().message }, 'areAddressesUsed failed')
  } else {
    const used = usedResult.unwrap()
    logger.info(
      { address: satoshiAddress.toString(), isUsed: used.has(satoshiAddress) },
      `Address used check (should be true)`,
    )
  }

  // 3. Get confirmed balance
  logger.info('--- getConfirmedAddressBalances ---')
  const balanceResult = await provider.getConfirmedAddressBalances(new IndexSet([satoshiAddress]))
  if (balanceResult.isErr()) {
    logger.error({ error: balanceResult.unwrapErr().message }, 'getConfirmedAddressBalances failed')
  } else {
    const balances = balanceResult.unwrap()
    const sats = balances.get(satoshiAddress) ?? 0n
    logger.info(
      { address: satoshiAddress.toString(), balanceSats: sats.toString(), balanceBTC: Number(sats) / 1e8 },
      'Confirmed balance',
    )
  }

  // 4. Get transaction entries (first few)
  logger.info('--- getTransactionEntries (first 3) ---')
  const addresses = new IndexMap<Address, number | null>([[satoshiAddress, null]])
  let count = 0
  for await (const entryResult of provider.getTransactionEntries(addresses)) {
    if (entryResult.isErr()) {
      logger.error({ error: entryResult.unwrapErr().message }, 'getTransactionEntries yielded error')
      break
    }
    const entry = entryResult.unwrap()
    logger.info(
      {
        txid: entry.txid.toString(),
        value: entry.value.toString(),
        confirmed: entry.confirmed,
        blockHeight: entry.blockHeight,
        timestamp: entry.timestamp.toISOString(),
      },
      `Transaction ${count + 1}`,
    )
    count++
    if (count >= 3) {
      logger.info('(stopping after 3 transactions)')
      break
    }
  }

  // Cleanup
  client.disconnect()
  logger.info('Disconnected. Smoke test complete!')
}

main().catch((err) => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
