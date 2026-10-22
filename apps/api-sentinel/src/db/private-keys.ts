import { checksum } from '@hoseki/packages/bitcoin/descriptor_utils'
import { bip32, bitcoin } from '@hoseki/packages/bitcoin/lib'
import { Ok, Result } from '@hoseki/packages/result'
import { eq, like } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { SentinelDb } from './drizzle'
import { accounts, keystores } from './schema'

const extendedPrivateKey = /[xt]prv[1-9A-HJ-NP-Za-km-z]+/g

/** Replaces every xprv/tprv in `text` with its xpub/tpub. */
export function replacePrivateKeys(text: string): Result<string, Error> {
  return Result.fromThrowable(() =>
    text.replace(extendedPrivateKey, (key) => {
      const network = key.startsWith('t') ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
      return bip32.fromBase58(key, network).neutered().toBase58()
    }),
  )
}

/** Replaces the descriptor's private keys and recomputes its checksum, if it has one. */
export function publicDescriptor(descriptor: string): Result<string, Error> {
  const [body = '', sum] = descriptor.split('#')
  return replacePrivateKeys(body).andThen((replaced) => (sum === undefined ? Ok(replaced) : checksum(replaced)))
}

/**
 * Watch-only import used to accept extended private keys. Replace any that were saved with their public keys,
 * so existing accounts keep loading now that only public keys parse. Never logs the keys themselves.
 */
export async function replaceStoredPrivateKeys(db: SentinelDb, logger: Logger): Promise<void> {
  const accountRows = await db
    .select({ id: accounts.id, value: accounts.descriptor })
    .from(accounts)
    .where(like(accounts.descriptor, '%prv%'))
  const keystoreRows = await db
    .select({ id: keystores.id, value: keystores.xpub })
    .from(keystores)
    .where(like(keystores.xpub, '%prv%'))

  let failed = 0
  function updates(
    rows: Array<{ id: string; value: string }>,
    replace: (value: string) => Result<string, Error>,
  ): Array<{ id: string; value: string }> {
    return rows.flatMap((row) => {
      const replaced = replace(row.value)
      if (replaced.isErr()) {
        failed += 1
        return []
      }
      return replaced.unwrap() === row.value ? [] : [{ id: row.id, value: replaced.unwrap() }]
    })
  }
  const accountUpdates = updates(accountRows, publicDescriptor)
  const keystoreUpdates = updates(keystoreRows, replacePrivateKeys)

  if (accountUpdates.length > 0 || keystoreUpdates.length > 0) {
    await db.transaction(async (tx) => {
      for (const update of accountUpdates) {
        await tx.update(accounts).set({ descriptor: update.value }).where(eq(accounts.id, update.id))
      }
      for (const update of keystoreUpdates) {
        await tx.update(keystores).set({ xpub: update.value }).where(eq(keystores.id, update.id))
      }
    })
    logger.warn(
      { accounts: accountUpdates.length, keystores: keystoreUpdates.length },
      'Replaced saved extended private keys with their public keys',
    )
  }
  if (failed > 0) {
    logger.error({ count: failed }, 'Could not replace saved extended private keys')
  }
}
