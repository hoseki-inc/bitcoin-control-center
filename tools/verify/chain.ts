import { createHash } from 'node:crypto'
import { SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import { bitcoin } from '@hoseki/packages/bitcoin/lib'
import { ecc } from '@hoseki/packages/bitcoin/lib/ecc'
import { Xpub } from '@hoseki/packages/bitcoin/xpub'
import { Wallets } from '@hoseki/packages/testing/wallets'
import { BIP32Factory } from 'bip32'
import { EMULATOR_FUNDING_OUTPUTS } from './emulator-seeds'

// Everything here is public test data. The signing key comes from a public 32-byte seed of 0x01 bytes, as in
// apps/api-sentinel/src/modules/trpc/ownership.fixtures.ts; it controls no real funds.

const SIGNING_PATH = "m/84'/0'/0'"
const signingNode = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, 1)).derivePath(SIGNING_PATH)
const signingXpub = Xpub.fromString(signingNode.neutered().toBase58()).expect('Test key must be a valid xpub')

const verifiedAccount = new SingleSigAccount('p2wpkh', signingXpub)

/** The test key's private key for a receive or change address, found by address. */
export function signingWif(address: string): string | null {
  for (const change of [0, 1] as const) {
    for (let index = 0; index < 20; index++) {
      if (verifiedAccount.address(change, index).toString() === address) {
        return signingNode.derive(change).derive(index).toWIF()
      }
    }
  }
  return null
}

export const SEED_ACCOUNTS = {
  verified: { displayName: 'Verify Savings', account: verifiedAccount },
  watchSegwit: { displayName: 'Verify Watch Segwit', account: Wallets.singlesigNativeSegwitAccount },
  watchTaproot: { displayName: 'Verify Watch Taproot', account: Wallets.singlesigTaprootAccount },
} as const

/** Funds come from, and payments go to, addresses that no seeded account owns. */
const OUTSIDE_FUNDER = Wallets.satoshiAddress.toString()
const OUTSIDE_PAYEE = Wallets.scriptAddress.toString()

const SATS = 100_000_000
const FEE = 1_000

interface ChainEvent {
  label: string
  date: string
  inputs: Array<{ from: string; vout: number } | 'funding'>
  outputs: Array<{ address: string; value: number }>
}

const receive = (key: keyof typeof SEED_ACCOUNTS, index: number): string =>
  SEED_ACCOUNTS[key].account.receiveAddress(index).toString()

/**
 * The seeded wallets' whole history, from December 2025 to April 2026, so statement periods have activity before,
 * inside and after them. Every event is at noon UTC, so it falls on the same date in time zones from UTC-11 to UTC+11.
 */
const EVENTS: ChainEvent[] = [
  {
    label: 'watch-segwit-deposit',
    date: '2025-12-15T12:00:00Z',
    inputs: ['funding'],
    outputs: [{ address: receive('watchSegwit', 0), value: 1 * SATS }],
  },
  {
    label: 'savings-deposit-1',
    date: '2026-01-10T12:00:00Z',
    inputs: ['funding'],
    outputs: [{ address: receive('verified', 0), value: 0.5 * SATS }],
  },
  {
    label: 'savings-deposit-2',
    date: '2026-02-05T12:00:00Z',
    inputs: ['funding'],
    outputs: [{ address: receive('verified', 1), value: 0.25 * SATS }],
  },
  {
    label: 'watch-taproot-deposit',
    date: '2026-02-20T12:00:00Z',
    inputs: ['funding'],
    outputs: [{ address: receive('watchTaproot', 0), value: 0.05 * SATS }],
  },
  {
    label: 'savings-payment',
    date: '2026-03-01T12:00:00Z',
    inputs: [{ from: 'savings-deposit-1', vout: 0 }],
    outputs: [
      { address: OUTSIDE_PAYEE, value: 0.1 * SATS },
      { address: verifiedAccount.changeAddress(0).toString(), value: 0.4 * SATS - FEE },
    ],
  },
  {
    label: 'savings-deposit-3',
    date: '2026-04-15T12:00:00Z',
    inputs: ['funding'],
    outputs: [{ address: receive('verified', 2), value: 0.1 * SATS }],
  },
  // Confirmed funding for public emulator test vectors (not added to SEED_ACCOUNTS, so baseline seed stays 3 accounts / 1.79999 BTC).
  ...EMULATOR_FUNDING_OUTPUTS.map((funding): ChainEvent => ({
    label: funding.label,
    date: funding.date,
    inputs: ['funding'],
    outputs: [{ address: funding.address, value: funding.valueSats }],
  })),
]

/** One block every ten minutes from this anchor, close to real mainnet heights. */
const ANCHOR_HEIGHT = 925_000
const ANCHOR_TIME = Date.UTC(2025, 11, 1) / 1000

function heightAt(epochSeconds: number): number {
  return ANCHOR_HEIGHT + Math.floor((epochSeconds - ANCHOR_TIME) / 600)
}

export function blockTime(height: number): number {
  return ANCHOR_TIME + (height - ANCHOR_HEIGHT) * 600
}

export function tipHeight(): number {
  return heightAt(Math.floor(Date.now() / 1000))
}

export function blockHeader(height: number): string {
  const header = Buffer.alloc(80)
  header.writeUInt32LE(0x20000000, 0)
  createHash('sha256')
    .update(`bcc-verify-block-${height - 1}`)
    .digest()
    .copy(header, 4)
  createHash('sha256').update(`bcc-verify-merkle-${height}`).digest().copy(header, 36)
  header.writeUInt32LE(blockTime(height), 68)
  header.writeUInt32LE(0x17034219, 72)
  header.writeUInt32LE(height, 76)
  return header.toString('hex')
}

interface ChainTx {
  label: string
  txid: string
  hex: string
  height: number
  tx: bitcoin.Transaction
}

function outputScript(address: string): Buffer {
  return bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)
}

function scripthash(script: Buffer): string {
  return Buffer.from(createHash('sha256').update(script).digest()).reverse().toString('hex')
}

export function scriptAddress(script: Buffer): string | undefined {
  try {
    return bitcoin.address.fromOutputScript(script, bitcoin.networks.bitcoin)
  } catch {
    return undefined
  }
}

function coinbase(label: string, height: number, value: number): bitcoin.Transaction {
  const tx = new bitcoin.Transaction()
  tx.version = 2
  const script = Buffer.concat([Buffer.from([0x03]), Buffer.from([height & 0xff, (height >> 8) & 0xff, height >> 16])])
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.concat([script, Buffer.from(label)]))
  tx.addOutput(outputScript(OUTSIDE_FUNDER), value)
  return tx
}

function buildChain(): ChainTx[] {
  const built: ChainTx[] = []
  const byLabel = new Map<string, ChainTx>()
  const add = (label: string, tx: bitcoin.Transaction, height: number): ChainTx => {
    const entry = { label, txid: tx.getId(), hex: tx.toHex(), height, tx }
    built.push(entry)
    byLabel.set(label, entry)
    return entry
  }

  for (const event of EVENTS) {
    const height = heightAt(Date.parse(event.date) / 1000)
    const total = event.outputs.reduce((sum, output) => sum + output.value, 0)
    const tx = new bitcoin.Transaction()
    tx.version = 2
    for (const input of event.inputs) {
      if (input === 'funding') {
        // A parent the funder received a week earlier, so every input has a known previous output.
        const parent = add(`${event.label}-funding`, coinbase(event.label, height - 1008, total + FEE), height - 1008)
        tx.addInput(Buffer.from(parent.txid, 'hex').reverse(), 0, 0xfffffffd)
      } else {
        const parent = byLabel.get(input.from)
        if (parent === undefined) {
          throw new Error(`Event ${event.label} spends unknown ${input.from}`)
        }
        tx.addInput(Buffer.from(parent.txid, 'hex').reverse(), input.vout, 0xfffffffd)
      }
    }
    for (const output of event.outputs) {
      tx.addOutput(outputScript(output.address), output.value)
    }
    add(event.label, tx, height)
  }
  return built
}

const CHAIN: ChainTx[] = buildChain()

export interface ChainIndex {
  byTxid: Map<string, ChainTx>
  history: Map<string, Array<{ tx_hash: string; height: number }>>
  unspent: Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>
}

/** Electrum's view of the chain: history and unspent outputs per scripthash. Only confirmed blocks count. */
export function indexChain(tip: number): ChainIndex {
  const byTxid = new Map<string, ChainTx>()
  const history = new Map<string, Array<{ tx_hash: string; height: number }>>()
  const unspent = new Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>()
  const outputOwner = new Map<string, string>()
  const touch = (hash: string, entry: ChainTx): void => {
    const list = history.get(hash) ?? []
    if (!list.some((item) => item.tx_hash === entry.txid)) {
      list.push({ tx_hash: entry.txid, height: entry.height })
    }
    history.set(hash, list)
  }

  for (const entry of [...CHAIN].sort((a, b) => a.height - b.height)) {
    if (entry.height > tip) {
      continue
    }
    byTxid.set(entry.txid, entry)
    for (const input of entry.tx.ins) {
      const spent = `${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`
      const owner = outputOwner.get(spent)
      if (owner !== undefined) {
        touch(owner, entry)
        unspent.set(
          owner,
          (unspent.get(owner) ?? []).filter((utxo) => `${utxo.tx_hash}:${utxo.tx_pos}` !== spent),
        )
      }
    }
    entry.tx.outs.forEach((output, position) => {
      const hash = scripthash(Buffer.from(output.script))
      outputOwner.set(`${entry.txid}:${position}`, hash)
      touch(hash, entry)
      unspent.set(hash, [
        ...(unspent.get(hash) ?? []),
        { tx_hash: entry.txid, tx_pos: position, height: entry.height, value: output.value },
      ])
    })
  }
  return { byTxid, history, unspent }
}

const DAY = 86_400
/** Mempool's daily history starts well before the earliest statement date, April 1, 2023. */
const PRICE_START = Date.UTC(2023, 0, 1) / 1000
const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, CHF: 0.88, AUD: 1.52, JPY: 150 } as const

/**
 * A made-up USD price for any day: $1,000 on January 1, 2023, plus $1 a day. Far below any real Bitcoin price, so a
 * real-looking price on screen means the app reached a real service.
 */
function usdPrice(epochSeconds: number): number {
  return 1_000 + Math.floor((epochSeconds - PRICE_START) / DAY)
}

type Quote = Record<keyof typeof RATES, number>

export interface PricePoint extends Quote {
  time: number
}

export interface PriceHistory {
  prices: PricePoint[]
  exchangeRates: Record<string, number>
}

function quote(epochSeconds: number): Quote {
  const usd = usdPrice(epochSeconds)
  return {
    USD: usd,
    EUR: Math.round(usd * RATES.EUR),
    GBP: Math.round(usd * RATES.GBP),
    CAD: Math.round(usd * RATES.CAD),
    CHF: Math.round(usd * RATES.CHF),
    AUD: Math.round(usd * RATES.AUD),
    JPY: Math.round(usd * RATES.JPY),
  }
}

export function currentPrice(): PricePoint {
  const now = Math.floor(Date.now() / 1000)
  return { time: now, ...quote(now) }
}

export function priceHistory(): PriceHistory {
  const prices: PricePoint[] = []
  for (let time = PRICE_START; time <= Date.now() / 1000; time += DAY) {
    prices.push({ time, ...quote(time) })
  }
  return {
    prices,
    exchangeRates: Object.fromEntries(Object.entries(RATES).map(([currency, rate]) => [`USD${currency}`, rate])),
  }
}
