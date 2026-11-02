import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  // WAL mode would otherwise keep the replaced pages on disk until a later checkpoint.
  for (const file of ['sentinel.db', 'sentinel.db-wal']) {
    const path = join(directory, file)
    const contents = existsSync(path) ? readFileSync(path, 'latin1') : ''
    for (const key of [mainnet, testnet, cosigner]) {
      expect(contents, file).not.toContain(key.toBase58())
    }
  }
})

it('leaves no copy of a private key in the database file after accounts were renamed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-private-keys-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const keys = Array.from({ length: 20 }, (_, index) => mainnet.deriveHardened(index).toBase58())
  const db = await openDrizzleDatabase(directory, logger)
  await db.insert(accounts).values(
    keys.map((key, index) => ({
      id: `account-${index}`,
      descriptor: checksum(`wpkh(${key}/<0;1>/*)`).expect('checksum'),
      displayName: `Account ${index}`,
    })),
  )
  // A longer name moves each row and leaves its old copy, private key included, in free space.
  await db.update(accounts).set({ displayName: 'A renamed account with a much longer name than before' })
  db.$client.close()

  const reopened = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    reopened.$client.close()
  })
  const contents = ['sentinel.db', 'sentinel.db-wal']
    .map((file) => join(directory, file))
    .map((path) => (existsSync(path) ? readFileSync(path, 'latin1') : ''))
    .join('')
  expect(keys.filter((key) => contents.includes(key))).toEqual([])
})
