import { currencies } from './currencies'
import { type MinorOrMajor, Money, type Source } from './money'

/**
 * Crypto currencies
 */

export class BTC extends Money<'BTC'> {
  override readonly currency = currencies.BTC

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.BTC, amount })
  }

  static fromSats(sats: Source): BTC {
    return new BTC({ minor: sats })
  }

  static fromBitcoin(btc: Source): BTC {
    return new BTC({ major: btc })
  }
}

export class USDT extends Money<'USDT'> {
  override readonly currency = currencies.USDT

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.USDT, amount })
  }

  static fromMicroUsdt(microUsdt: Source): USDT {
    return new USDT({ minor: microUsdt })
  }

  static fromUsdt(usdt: Source): USDT {
    return new USDT({ major: usdt })
  }
}

export class USDC extends Money<'USDC'> {
  override readonly currency = currencies.USDC

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.USDC, amount })
  }

  static fromMicroUsdc(microUsdc: Source): USDC {
    return new USDC({ minor: microUsdc })
  }

  static fromUsdc(usdc: Source): USDC {
    return new USDC({ major: usdc })
  }
}

export class ETH extends Money<'ETH'> {
  override readonly currency = currencies.ETH

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.ETH, amount })
  }

  static fromEther(ether: Source): ETH {
    return new ETH({ major: ether })
  }

  static fromWei(wei: Source): ETH {
    return new ETH({ minor: wei })
  }
}

export class SOL extends Money<'SOL'> {
  override readonly currency = currencies.SOL

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.SOL, amount })
  }

  static fromSol(sol: Source): SOL {
    return new SOL({ major: sol })
  }

  static fromLamports(lamports: Source): SOL {
    return new SOL({ minor: lamports })
  }
}

/**
 * Fiat currencies
 */

export class USD extends Money<'USD'> {
  override readonly currency = currencies.USD

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.USD, amount })
  }

  static fromCents(cents: Source): USD {
    return new USD({ minor: cents })
  }

  static fromDollars(dollars: Source): USD {
    return new USD({ major: dollars })
  }
}
