import { expect, test } from 'vitest'
import { getChecksum } from './descriptor_utils'

test('getChecksum - leaves the descriptor out of its error, since callers log it', () => {
  // A pasted smart quote is not a valid descriptor character.
  const descriptor =
    'wpkh(xpub6DppyoduRB3cPSijLSWPb4SgmKvm1JhTYHNsUVNcfxa2snrwBjxRmbndfJeKA3DSSBTbmo2haF9W3sSBaQNGPpHMPrMZN3crMeC3hb2HSyu/<0;1>/*)’'
  const result = getChecksum(descriptor)
  expect(result.isErr()).toBe(true)
  expect(result.unwrapErr().message).not.toContain('xpub6Dppyo')
})
