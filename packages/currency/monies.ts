import { currencies } from './currencies'
import { type MinorOrMajor, Money, type Source } from './money'

/**
 * Crypto currencies
 */

export class BTC extends Money<'BTC'> {
  public override readonly currency = currencies.BTC

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.BTC, amount })
  }

  public static fromSats(sats: Source): BTC {
    return new BTC({ minor: sats })
  }

  public static fromBitcoin(btc: Source): BTC {
    return new BTC({ major: btc })
  }
}

export class USDT extends Money<'USDT'> {
  public override readonly currency = currencies.USDT

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.USDT, amount })
  }

  public static fromMicroUsdt(microUsdt: Source): USDT {
    return new USDT({ minor: microUsdt })
  }

  public static fromUsdt(usdt: Source): USDT {
    return new USDT({ major: usdt })
  }
}

export class USDC extends Money<'USDC'> {
  public override readonly currency = currencies.USDC

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.USDC, amount })
  }

  public static fromMicroUsdc(microUsdc: Source): USDC {
    return new USDC({ minor: microUsdc })
  }

  public static fromUsdc(usdc: Source): USDC {
    return new USDC({ major: usdc })
  }
}

export class ETH extends Money<'ETH'> {
  public override readonly currency = currencies.ETH

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.ETH, amount })
  }

  public static fromEther(ether: Source): ETH {
    return new ETH({ major: ether })
  }

  public static fromWei(wei: Source): ETH {
    return new ETH({ minor: wei })
  }
}

export class SOL extends Money<'SOL'> {
  public override readonly currency = currencies.SOL

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.SOL, amount })
  }

  public static fromSol(sol: Source): SOL {
    return new SOL({ major: sol })
  }

  public static fromLamports(lamports: Source): SOL {
    return new SOL({ minor: lamports })
  }
}

/**
 * Fiat currencies
 */

export class USD extends Money<'USD'> {
  public override readonly currency = currencies.USD

  private constructor(amount: MinorOrMajor) {
    super({ currency: currencies.USD, amount })
  }

  public static fromCents(cents: Source): USD {
    return new USD({ minor: cents })
  }

  public static fromDollars(dollars: Source): USD {
    return new USD({ major: dollars })
  }
}
