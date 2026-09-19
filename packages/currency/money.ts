import { type Decimal } from 'decimal.js'
import { type Code, Currency, type CurrencyOptions } from './currency'

type Without<T, U> = {
  [K in Exclude<keyof T, keyof U>]?: never
}

type MergeExclusive<T, U> = T | U extends object ? (Without<T, U> & U) | (Without<U, T> & T) : T | U

export type Other<T extends Code> = Money<T> | Source

export type Source = number | bigint | string | Decimal

export type MinorOrMajor = MergeExclusive<{ minor: Source }, { major: Source }>

export interface MoneyOptions<T extends Code> {
  currency: Currency<T> | CurrencyOptions<T>
  amount: MinorOrMajor
}

export class Money<T extends Code = Code> {
  public readonly currency: Currency<T>
  public readonly amount: Decimal

  protected constructor(options: MoneyOptions<T>) {
    //
    this.currency = options.currency instanceof Currency ? options.currency : new Currency(options.currency)
    if (options.amount.minor !== undefined) {
      this.amount = this.sourceToBigNumber(options.amount.minor)
    } else {
      this.amount = this.sourceToBigNumber(options.amount.major).times(this.factor())
    }
  }

  public static from<T extends string>(options: MoneyOptions<T>): Money<T> {
    return new Money(options)
  }

  public static fromMinor<T extends string>(currency: Currency<T>, minor: Source): Money<T> {
    return Money.from({ currency, amount: { minor } })
  }

  public static fromMajor<T extends string>(currency: Currency<T>, major: Source): Money<T> {
    return Money.from({ currency, amount: { major } })
  }

  public factor(): Decimal {
    return new this.currency.Decimal(10).pow(this.currency.exponent)
  }

  protected sourceToBigNumber(source: Source): Decimal {
    return new this.currency.Decimal(source.toString())
  }

  protected getAmount(other: Other<T>): Decimal {
    if (other instanceof Money) {
      return other.amount
    }
    return this.sourceToBigNumber(other)
  }

  private invariant(other: Other<T>) {
    if (other instanceof Money && !this.currency.equals(other.currency)) {
      throw new Error('Cannot compare money of different currencies')
    }
  }

  protected withMinor(minor: Source): Money<T> {
    return new Money({
      currency: this.currency,
      amount: { minor },
    })
  }

  public toMajorAmount(): Decimal {
    return this.amount.dividedBy(this.factor())
  }

  public add(other: Other<T>): Money<T> {
    this.invariant(other)
    return this.withMinor(this.amount.plus(this.getAmount(other)))
  }

  public sub(other: Other<T>): Money<T> {
    this.invariant(other)
    return this.withMinor(this.amount.minus(this.getAmount(other)))
  }

  public mul(other: Other<T>): Money<T> {
    this.invariant(other)
    return this.withMinor(this.amount.times(this.getAmount(other)))
  }

  public div(other: Other<T>): Money<T> {
    this.invariant(other)
    return this.withMinor(this.amount.dividedBy(this.getAmount(other)))
  }

  public eq(other: Other<T>): boolean {
    this.invariant(other)
    return this.amount.eq(this.getAmount(other))
  }

  public gt(other: Other<T>): boolean {
    this.invariant(other)
    return this.amount.gt(this.getAmount(other))
  }

  public gte(other: Other<T>): boolean {
    this.invariant(other)
    return this.amount.gte(this.getAmount(other))
  }

  /**
   * Finance uses major units, so assume that `quote` is per major units.
   */
  public convert<U extends Code>(quote: Money<U>): Money<U> {
    //
    if (this.currency.equals(quote.currency)) {
      return quote
    }

    if (this.amount.isZero()) {
      return quote.withMinor(0)
    }

    const quoteFactor = quote.factor()
    const adjustedPrice = quote.amount.dividedBy(quoteFactor)
    const convertedAmount = this.amount.times(adjustedPrice).dividedBy(this.factor())
    return quote.withMinor(convertedAmount.times(quoteFactor))
  }

  public toJSON(): { code: T; amount: string } {
    return { code: this.currency.code, amount: this.amount.toFixed() }
  }

  public toString(): string {
    return JSON.stringify(this.toJSON())
  }

  public toDto(rate?: Money<'USD'>): {
    code: T
    minor: string
    major: string
    usdRate?: string
    usdValue?: string
  } {
    return {
      code: this.currency.code,
      minor: this.amount.toFixed(),
      major: this.toMajorAmount().toFixed(),
      usdRate: rate ? rate.toMajorAmount().toFixed() : undefined,
      usdValue: rate ? this.convert(rate).toMajorAmount().toFixed() : undefined,
    }
  }
}
