import { sha256 } from '@noble/hashes/sha2.js'
import { Err, Ok, type Result } from '@patina/core'
import type { Address } from './address'
import { bitcoin } from './lib'
import type { Network } from './network'

/**
 * Convert a Network to the bitcoinjs-lib network object required by `toOutputScript`.
 */
function toBitcoinjsNetwork(network: Network): typeof bitcoin.networks.bitcoin {
  switch (network.kind) {
    case 'Mainnet':
      return bitcoin.networks.bitcoin
    case 'Testnet':
      return bitcoin.networks.testnet
    case 'Regtest':
      return bitcoin.networks.regtest
  }
}

/**
 * Compute the Electrum scripthash for a Bitcoin address.
 *
 * The Electrum protocol indexes addresses by their "scripthash", which is
 * the SHA256 hash of the output script, with bytes reversed (little-endian).
 *
 * @param address - A validated Bitcoin Address
 * @returns The scripthash as a hex string, or an error if the address cannot be converted to an output script
 */
export function addressToScripthash(address: Address): Result<string, Error> {
  try {
    const network = toBitcoinjsNetwork(address.network())
    const outputScript = bitcoin.address.toOutputScript(address.toString(), network)
    const hash = sha256(new Uint8Array(outputScript))
    // Electrum uses reversed byte order (little-endian)
    const reversed = new Uint8Array(hash).reverse()
    return Ok(Buffer.from(reversed).toString('hex'))
  } catch (err) {
    return Err(err instanceof Error ? err : new Error(String(err)))
  }
}
