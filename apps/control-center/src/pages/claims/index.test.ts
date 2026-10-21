// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { Decimal } from 'decimal.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { claimFixture } from '../../testing/claims'
import { AccountCard, type AccountCardProps } from './index'

/** A wallet card's visible text, without Chakra's injected styles or markup. */
function renderWalletCard(balance: AccountCardProps['balance']): string {
  const card = createElement(AccountCard, {
    claim: claimFixture('re_clmx_wallet', 'Cold storage'),
    balance,
    totalBtcSats: 123_456_789,
    isLoadingBalance: false,
  })
  return renderToStaticMarkup(createElement(ChakraProvider, null, createElement(MemoryRouter, null, card)))
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
}

describe('Wallet account card', () => {
  it('shows the Bitcoin balance without a dollar value when there is no price', () => {
    const text = renderWalletCard({ current: new Decimal(123_456_789), usd: null })
    expect(text).toContain('1.23456789 BTC')
    expect(text).not.toContain('$')
  })

  it('shows the dollar value when there is a price', () => {
    const text = renderWalletCard({ current: new Decimal(123_456_789), usd: new Decimal('61728.39') })
    expect(text).toContain('1.23456789 BTC')
    expect(text).toContain('$61,728.39')
  })
})
