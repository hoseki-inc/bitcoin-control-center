import Decimal from 'decimal.js'
import { isUsableBtcPrice } from './bitcoin-display'
import type { WalletBalanceStatus } from './wallet-balances'

/** Convert the Bitcoin subtotal for a combined portfolio summary without treating unknown balances as zero. */
export function bitcoinUsdValue({
  balanceSats,
  priceUsd,
  balanceUnavailable = false,
  walletStatus,
}: {
  balanceSats: number | null
  priceUsd: number | null
  balanceUnavailable?: boolean
  walletStatus: WalletBalanceStatus
}): number | null {
  if (
    balanceUnavailable ||
    walletStatus.kind === 'unreachable' ||
    balanceSats === null ||
    !Number.isFinite(balanceSats) ||
    balanceSats < 0
  ) {
    return null
  }
  if (balanceSats === 0) {
    return 0
  }
  if (!isUsableBtcPrice(priceUsd)) {
    return null
  }
  const value = new Decimal(balanceSats).div(100_000_000).mul(priceUsd).toNumber()
  return Number.isFinite(value) ? value : null
}
