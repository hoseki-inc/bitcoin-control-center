import { z } from 'zod'
import { Network, Xpub, bs58check } from '../bitcoin'
import { Err, Ok, Result } from '../result'

/**
 * SLIP-132 extended public key prefixes
 * @see https://github.com/satoshilabs/slips/blob/master/slip-0132.md
 */
export const prefixSchema = z.enum(['x', 'y', 'Y', 'z', 'Z', 't', 'u', 'U', 'v', 'V'])
export type Prefix = z.infer<typeof prefixSchema>

export const pubKeyRegex = /[xyYzZtuUvV]pub[1-9A-HJ-NP-Za-km-z]{79,108}/

/**
 * Human-readable descriptions for SLIP-132 extended public key prefixes
 * @see https://github.com/satoshilabs/slips/blob/master/slip-0132.md
 */
export const PREFIX_DESCRIPTIONS = {
  x: 'xpub (Bitcoin Core format, any script type)',
  y: 'ypub (P2WPKH-in-P2SH/P2WSH-in-P2SH, nested segwit)',
  Y: 'Ypub (P2WSH-in-P2SH, nested segwit multisig)',
  z: 'zpub (P2WPKH/P2WSH, native segwit)',
  Z: 'Zpub (P2WSH, native segwit multisig)',
  t: 'tpub (Bitcoin Core format testnet, any script type)',
  u: 'upub (P2WPKH-in-P2SH/P2WSH-in-P2SH testnet, nested segwit)',
  U: 'Upub (P2WSH-in-P2SH testnet, nested segwit multisig)',
  v: 'vpub (P2WPKH/P2WSH testnet, native segwit)',
  V: 'Vpub (P2WSH testnet, native segwit multisig)',
} as const satisfies Record<Prefix, string>

function getNetworkFromPrefix(prefix: string): Result<Network.Mainnet | Network.Testnet, Error> {
  switch (prefix) {
    // mainnet SLIP-132 / core
    case 'x':
    case 'y':
    case 'Y':
    case 'z':
    case 'Z':
      return Ok(Network.Mainnet)

    // testnet SLIP-132 / core
    case 't':
    case 'u':
    case 'U':
    case 'v':
    case 'V':
      return Ok(Network.Testnet)

    default:
      return Err(new Error(`invalid first character of xpub: "${prefix}"`))
  }
}

/**
 * Accepts core (`xpub`/`tpub`) and SLIP-132 (`ypub`/`Ypub`/`zpub`/`Zpub`/`upub`/`Upub`/`vpub`/`Vpub`) strings
 * and returns a normalized core `xpub`/`tpub` string.
 */
export function toCoreXpubString(str: string): Result<string, Error> {
  const firstChar = str[0]
  if (firstChar == null) {
    return Err(new Error('xpub string is empty'))
  }
  if (str.length > Xpub.MAX_STRING_LENGTH) {
    return Err(new Error(`xpub string is longer than ${Xpub.MAX_STRING_LENGTH} characters`))
  }

  return getNetworkFromPrefix(firstChar).andThen((network) => {
    return Result.fromThrowable(() => {
      const decoded = bs58check.decode(str)

      // Overwrite the first 4 bytes (version bytes) to match the core network xpub/tpub prefix.
      for (let i = 0; i < 4; i++) {
        const newByte = network.bip32.publicBuffer[i]
        if (newByte == null) {
          throw new Error(`did not find version byte at index ${i}`)
        }
        decoded[i] = newByte
      }

      return bs58check.encode(decoded)
    })
  })
}

/**
 * Parses an xpub string that may be in SLIP-132 format by first normalizing to core (`xpub`/`tpub`).
 */
export function getXpubFromString(slip132string: string): Result<Xpub, Error> {
  return toCoreXpubString(slip132string).andThen((core) => Xpub.fromString(core))
}

/**
 * Zod schema that accepts SLIP-132 or core extpub strings and outputs a `Xpub` object.
 * Equivalent to `bitcoinXpubStringSchema` from the bitcoin package but also accepts SLIP-132 format.
 */
export const xpubStringSchema = z.string().transform((val, ctx) => {
  const parsed = getXpubFromString(val)
  if (parsed.isErr()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: parsed.unwrapErr().message,
    })
    return z.NEVER
  }
  return parsed.unwrap()
})
