import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Account } from '@hoseki/packages/bitcoin/account'
import { checksum } from '@hoseki/packages/bitcoin/descriptor_utils'
import { bip32, bitcoin } from '@hoseki/packages/bitcoin/lib'
import { asc } from 'drizzle-orm'
import pino from 'pino'
import { expect, it, onTestFinished } from 'vitest'
import { openDrizzleDatabase } from './drizzle'
import { accounts, keystores } from './schema'

const logger = pino({ level: 'silent' })
// BIP32 test vector 1 seed: a published vector, not a real wallet.
const seed = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
const mainnet = bip32.fromSeed(seed, bitcoin.networks.bitcoin)
const testnet = bip32.fromSeed(seed, bitcoin.networks.testnet)
const cosigner = mainnet.deriveHardened(0)

it('replaces saved private keys with their public keys when the database opens', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-private-keys-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const descriptors = {
    singlesig: checksum(`wpkh(${mainnet.toBase58()}/<0;1>/*)`).expect('checksum'),
    testnet: `wpkh(${testnet.toBase58()}/<0;1>/*)`,
    multisig: checksum(
      `wsh(sortedmulti(1,[3442193e/0h]${cosigner.toBase58()}/<0;1>/*,${mainnet.neutered().toBase58()}/<0;1>/*))`,
    ).expect('checksum'),
    public: checksum(`wpkh(${mainnet.neutered().toBase58()}/<0;1>/*)`).expect('checksum'),
    broken: 'wpkh(xprvNotAKey/<0;1>/*)',
  }
  const db = await openDrizzleDatabase(directory, logger)
  await db.insert(accounts).values(
    Object.entries(descriptors).map(([id, descriptor]) => ({
      id,
      descriptor,
      displayName: id,
      network: id === 'testnet' ? 'testnet' : 'mainnet',
    })),
  )
  await db.insert(keystores).values([
    { id: 'singlesig', accountId: 'singlesig', label: 'Key', xpub: mainnet.toBase58() },
    { id: 'cosigner', accountId: 'multisig', label: 'Key', xpub: cosigner.toBase58() },
    { id: 'testnet', accountId: 'testnet', label: 'Key', xpub: testnet.toBase58() },
  ])
  db.$client.close()

  const reopened = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    reopened.$client.close()
  })
  const rows = await reopened.select().from(accounts).orderBy(asc(accounts.id))
  const keys = await reopened.select().from(keystores).orderBy(asc(keystores.id))

  const stored = Object.fromEntries(rows.map((row) => [row.id, row.descriptor]))
  expect(stored).toEqual({
    singlesig: checksum(`wpkh(${mainnet.neutered().toBase58()}/<0;1>/*)`).expect('checksum'),
    testnet: `wpkh(${testnet.neutered().toBase58()}/<0;1>/*)`,
    multisig: checksum(
      `wsh(sortedmulti(1,[3442193e/0h]${cosigner.neutered().toBase58()}/<0;1>/*,${mainnet.neutered().toBase58()}/<0;1>/*))`,
    ).expect('checksum'),
    public: descriptors.public,
    broken: descriptors.broken,
  })
  for (const id of ['singlesig', 'testnet', 'multisig']) {
    expect(Account.fromDescriptor(stored[id] ?? '').isOk(), id).toBe(true)
  }
  expect(keys.map((key) => key.xpub)).toEqual([
    cosigner.neutered().toBase58(),
    mainnet.neutered().toBase58(),
    testnet.neutered().toBase58(),
  ])
})
