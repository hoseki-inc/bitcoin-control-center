import Decimal from 'decimal.js'
import { BTC, type Source } from '../currency'

/**
 * Converts a BTC amount to USD using the given price.
 *
 * @param btc - The BTC amount in sats to convert.
 * @param price - The price of BTC in USD.
 *
 * @returns The USD value of the BTC amount.
 */
export function convertBtcToUsd(btc: Source, price: Decimal.Value): Decimal {
  return new Decimal(price).mul(BTC.fromSats(btc).toMajorAmount())
}
