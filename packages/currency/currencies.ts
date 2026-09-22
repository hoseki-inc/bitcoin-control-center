import { z } from 'zod'
import { Currency } from './currency'

export const CurrencyCodeSchema = z.enum(['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'USD', 'EUR'])
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>

export const currencies = {
  // Major cryptocurrencies
  BTC: new Currency({
    code: 'BTC',
    // BTC smallest unit is satoshi, https://en.bitcoin.it/wiki/Satoshi_(unit)
    exponent: 8,
    // BTC has 8 decimals, but we allow Lightning millisatoshis
    decimals: Currency.MILLI_DECIMALS,
  }),
  ETH: new Currency({
    code: 'ETH',
    // ETH smallest unit is wei, https://docs.soliditylang.org/en/latest/units-and-global-variables.html
    exponent: 18,
    // Allow for millitokens just in case
    decimals: Currency.MILLI_DECIMALS,
  }),
  SOL: new Currency({
    code: 'SOL',
    // SOL smallest unit is lamport, https://docs.solana.com/terminology#lamport
    exponent: 9,
    decimals: Currency.MAX_DECIMALS,
  }),

  // Stablecoin and fiat currency decimals will be set to the maximum,
  // because even though these values can't settle on-chain,
  // we may need to perform calculations with them.

  // Stablecoins
  USDT: new Currency({
    code: 'USDT',
    // USDT smallest unit is micro-USDT, https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7#code
    exponent: 6,
    decimals: Currency.MAX_DECIMALS,
  }),
  USDC: new Currency({
    code: 'USDC',
    // USDC smallest unit is micro-USDC, https://etherscan.io/token/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48#code
    exponent: 6,
    decimals: Currency.MAX_DECIMALS,
  }),

  // Fiat currencies
  USD: new Currency({
    code: 'USD',
    // USD smallest unit is cent
    exponent: 2,
    decimals: Currency.MAX_DECIMALS,
  }),
  EUR: new Currency({
    code: 'EUR',
    // EUR smallest unit is cent
    exponent: 2,
    decimals: Currency.MAX_DECIMALS,
  }),
} as const satisfies { [Code in CurrencyCode]: Currency<Code> }
