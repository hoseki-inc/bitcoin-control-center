import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

/** Exactly six ASCII digits. Parsed where a PIN enters, so a malformed one never costs an attempt or a hash. */
export const Pin = z
  .string()
  .regex(/^[0-9]{6}$/, 'The PIN must be exactly 6 digits')
  .brand<'Pin'>()
export type Pin = z.infer<typeof Pin>

/** `scrypt$N$r$p$salt$hash`, with salt and hash in base64url, so the cost can change without breaking old hashes. */
export const PIN_HASH_PATTERN = /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/

// About 32 MiB and tens of milliseconds per hash. Six digits can be tried offline from a copied database
// whatever the cost; the hash keeps the PIN out of plain sight, and the server's delays stop online guessing.
const COST = 2 ** 15
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const MAX_MEMORY = 64 * 1024 * 1024

async function derive(pin: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) {
        reject(error)
      } else {
        resolve(key)
      }
    })
  })
}

export async function hashPin(pin: Pin): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(pin, salt, COST, BLOCK_SIZE, PARALLELISM)
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/** False for a wrong PIN and for a hash this build can't read. */
export async function verifyPin(pin: Pin, stored: string): Promise<boolean> {
  if (!PIN_HASH_PATTERN.test(stored)) {
    return false
  }
  const [, N, r, p, salt, hash] = stored.split('$')
  const expected = Buffer.from(hash ?? '', 'base64url')
  if (expected.length !== KEY_LENGTH) {
    return false
  }
  const key = await derive(pin, Buffer.from(salt ?? '', 'base64url'), Number(N), Number(r), Number(p))
  return timingSafeEqual(key, expected)
}
