import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/** A PIN is exactly six ASCII digits. */
export const PIN_PATTERN = /^[0-9]{6}$/

// About 32 MiB and tens of milliseconds per hash. Six digits can be tried offline from a copied database
// whatever the cost; the hash keeps the PIN out of plain sight, and the server's delays stop online guessing.
const COST = 2 ** 15
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const MAX_MEMORY = 64 * 1024 * 1024

export function isPin(value: string): boolean {
  return PIN_PATTERN.test(value)
}

async function derive(
  pin: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) {
        reject(error)
      } else {
        resolve(key)
      }
    })
  })
}

/** `scrypt$N$r$p$salt$hash`, with salt and hash in base64url, so the cost can change without breaking old hashes. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(pin, salt, COST, BLOCK_SIZE, PARALLELISM)
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/** False for a wrong PIN and for a hash this build can't read. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, cost, blockSize, parallelism, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) {
    return false
  }
  const params = [cost, blockSize, parallelism].map(Number)
  const [n, r, p] = params
  if (n === undefined || r === undefined || p === undefined || !params.every(Number.isSafeInteger)) {
    return false
  }
  const expected = Buffer.from(hash, 'base64url')
  if (expected.length !== KEY_LENGTH) {
    return false
  }
  const key = await derive(pin, Buffer.from(salt, 'base64url'), n, r, p)
  return timingSafeEqual(key, expected)
}
