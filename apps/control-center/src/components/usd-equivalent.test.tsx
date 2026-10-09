import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { UsdEquivalent } from './usd-equivalent'

it('shows the USD value at a usable price', () => {
  expect(renderToStaticMarkup(<UsdEquivalent btc="0.5" btcPrice={100_000} />)).toBe('$50,000.00 USD')
})

it.each([
  ['zero', 0],
  ['not a number', Number.NaN],
  ['missing', null],
])('shows no USD amount when the price is %s', (_label, btcPrice) => {
  expect(renderToStaticMarkup(<UsdEquivalent btc="0.5" btcPrice={btcPrice} />)).toBe('USD unavailable')
})
