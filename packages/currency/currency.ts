import { Decimal as DecimalLib } from 'decimal.js'
import { Panic } from '../result'

export type CurrencyJson<T extends Code> = { code: T; exponent: number; decimals: number }

export type Code = string

export type CurrencyOptions<T extends Code> = Pick<Currency<T>, 'code' | 'decimals' | 'exponent'>

export class Currency<T extends Code = Code> {
  /** 2^512 is 155 digits long */
  public static MAX_EXPONENT = 155 as const
  /** Same precision supported by DB */
  public static PRECISION = 178 as const

  /** 18 decimals is generally recommended in finance, used for ERC20 as well */
  public static MAX_DECIMALS = 18 as const
  public static MILLI_DECIMALS = 3 as const
  public static MICRO_DECIMALS = 6 as const

  /** Unique identifier for the currency, e.g., BTC or USD */
  public readonly code: T

  /**
   * The currency exponent expresses the decimal relationship between the currency and its minor unit.
   *
   * For example, there are 100_000_000 sats in a bitcoin, being 10 to the power of 8, so the exponent for bitcoin is 8.
   */
  public readonly exponent: number

  /**
   * The number of decimal places that the minor unit can be split into.
   *
   * For example, BTC may have 3 decimal places, to support Lightning millisatoshis.
   */
  public readonly decimals: number

  public readonly Decimal: typeof DecimalLib

  public constructor(options: CurrencyOptions<T>) {
    this.code = options.code

    if (options.exponent > Currency.MAX_EXPONENT) {
      throw new Panic(`Currency ${options.code} has an exponent greater than the maximum of ${Currency.MAX_EXPONENT}`)
    }

    this.exponent = options.exponent

    if (options.decimals > Currency.MAX_DECIMALS) {
      throw new Panic(`Currency ${options.code} has a decimals greater than the maximum of ${Currency.MAX_DECIMALS}`)
    }
    this.decimals = options.decimals

    this.Decimal = DecimalLib.clone({
      precision: Currency.PRECISION,
      // Round down avoid rounding up someone's balance.
      rounding: DecimalLib.ROUND_DOWN,
    })
  }

  public equals<U extends Code>(other: Currency<U>): boolean {
    return (
      // @ts-expect-error - T and U may overlap if both are string
      this.code === other.code && this.exponent === other.exponent && this.decimals === other.decimals
    )
  }

  public toOptions(): CurrencyOptions<T> {
    return {
      code: this.code,
      exponent: this.exponent,
      decimals: this.decimals,
    }
  }

  public toJSON(): CurrencyJson<T> {
    return {
      code: this.code,
      exponent: this.exponent,
      decimals: this.decimals,
    }
  }

  public toString(): string {
    return JSON.stringify(this.toJSON())
  }
}
