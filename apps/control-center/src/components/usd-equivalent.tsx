import Decimal from 'decimal.js'

export function UsdEquivalent({
  btc,
  btcPrice,
  showSign = false,
}: {
  btc: Decimal.Value
  btcPrice: number | null
  showSign?: boolean
}): JSX.Element {
  if (btcPrice === null || !Number.isFinite(btcPrice) || btcPrice <= 0) {
    return <>USD unavailable</>
  }

  const value = new Decimal(btc).times(btcPrice).toNumber()
  return (
    <>
      {value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        signDisplay: showSign ? 'exceptZero' : 'auto',
      })}{' '}
      USD
    </>
  )
}
