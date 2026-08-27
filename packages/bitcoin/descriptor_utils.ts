import { DescriptorChecksum } from '@bitcoinerlab/descriptors/dist/checksum'
import { Err, Ok, Result } from '../result'

export function getChecksum(span: string): Result<string, Error> {
  return Result.from(() => DescriptorChecksum(span)).andThen((checksum) => {
    if (checksum === '') {
      return Err(new Error(`could not compute checksum, invalid character in ${span}`))
    }
    return Ok(checksum)
  })
}

export function checksum(span: string): Result<`${string}#${string}`, Error> {
  return getChecksum(span).map((checksum) => `${span}#${checksum}` as const)
}

export function pkh(span: string): `pkh(${string})` {
  return `pkh(${span})`
}

export function sh(span: string): `sh(${string})` {
  return `sh(${span})`
}

export function wpkh(span: string): `wpkh(${string})` {
  return `wpkh(${span})`
}

export function wsh(span: string): `wsh(${string})` {
  return `wsh(${span})`
}

export function tr(span: string): `tr(${string})` {
  return `tr(${span})`
}

/**
 * https://github.com/bitcoin/bips/blob/master/bip-0389.mediawiki
 */
export function accountRange(span: string): `${string}/<0;1>/*` {
  return `${span}/<0;1>/*`
}

export function multi(threshold: number, span: string[]): `multi(${number},${string})` {
  return `multi(${threshold},${span.join(',')})`
}

export function sortedmulti(threshold: number, span: string[]): `sortedmulti(${number},${string})` {
  return `sortedmulti(${threshold},${span.join(',')})`
}

export function addr<T extends string>(span: T): `addr(${T})` {
  return `addr(${span})`
}
