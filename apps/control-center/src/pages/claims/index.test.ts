// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { Decimal } from 'decimal.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { WalletBalanceRow } from '../../lib/wallet-balances'
import { claimFixture } from '../../testing/claims'
import type { ClaimDto } from '../../trpc/server-types'
import type {
  AccountsDataSource,
  AccountsListQuery,
  EtfAccountDto,
  ExchangeAccountDto,
  ManualAccountDto,
} from './accounts-data'
import { AccountCard, type AccountCardProps, ClaimsPage } from './index'

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

interface PageState {
  claims: ClaimDto[]
  exchanges: ExchangeAccountDto[]
  manual: ManualAccountDto[]
  loading: Partial<Record<'claims' | 'exchange' | 'manual' | 'etf', boolean>>
  walletRows: WalletBalanceRow[] | undefined
  btcPrice: string | null
}

/** A list query as React Query reports it: no data while loading for the first time. */
function listQuery<T>(data: T[], isLoading = false): AccountsListQuery<T> {
  return {
    data: isLoading ? undefined : data,
    isLoading,
    isError: false,
    refetch: async () => Promise.resolve({ isError: false }),
  }
}

function renderPage(overrides: Partial<PageState> = {}): string {
  const state: PageState = {
    claims: [],
    exchanges: [],
    manual: [],
    loading: {},
    walletRows: [],
    btcPrice: '50000',
    ...overrides,
  }
  const dataSource: AccountsDataSource = {
    useLists: () => ({
      claimsQuery: listQuery(state.claims, state.loading.claims),
      exchangeAccountsQuery: listQuery(state.exchanges, state.loading.exchange),
      manualAccountsQuery: listQuery(state.manual, state.loading.manual),
      etfAccountsQuery: listQuery<EtfAccountDto>([], state.loading.etf),
      archivedClaimsQuery: listQuery<ClaimDto>([]),
      btcPriceQuery: {
        data:
          state.btcPrice === null
            ? undefined
            : { value: new Decimal(state.btcPrice), asOf: new Date(), source: 'block', lastKnown: false },
        isLoading: false,
      },
    }),
    useWalletBalances: () => ({ rows: state.walletRows, isError: false }),
    useRestore: () => ({ restore: () => undefined, restoringId: null }),
    useAutoRefresh: () => undefined,
  }
  return renderToStaticMarkup(
    createElement(ChakraProvider, null, createElement(MemoryRouter, null, createElement(ClaimsPage, { dataSource }))),
  )
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

const manualAccount: ManualAccountDto = {
  id: 'manual-1',
  displayName: 'Paper wallet',
  currency: 'BTC',
  balance: '100000000',
  balanceAsOf: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}
const wallet = claimFixture('re_clmx_wallet', 'Cold storage')
const walletRow = (overrides: Partial<WalletBalanceRow> = {}): WalletBalanceRow => ({
  accountId: wallet.id,
  balanceSats: '50000000',
  asOf: new Date().toISOString(),
  syncing: false,
  failed: false,
  failure: null,
  ...overrides,
})

describe('Accounts page', () => {
  it('keeps its outline until every account list has loaded, never flashing the empty state', () => {
    const text = renderPage({ manual: [manualAccount], loading: { manual: true } })
    expect(text).toContain('Loading accounts')
    expect(text).not.toContain('No accounts connected yet')
    expect(text).not.toContain('Paper wallet')
  })

  it('shows the empty state once every list has loaded empty', () => {
    expect(renderPage()).toContain('No accounts connected yet')
  })

  it('shows a recorded wallet balance at once while a newer one is fetched', () => {
    const text = renderPage({
      claims: [wallet],
      walletRows: [walletRow({ syncing: true, asOf: new Date(Date.now() - 20 * 60_000).toISOString() })],
    })
    expect(text).toContain('0.50000000 BTC')
    expect(text).toContain('Updating balances')
  })

  it('holds the total and shares back while a wallet has no balance yet, rather than count it as zero', () => {
    const text = renderPage({
      claims: [wallet],
      manual: [manualAccount],
      walletRows: [walletRow({ balanceSats: null, asOf: null, syncing: true })],
    })
    expect(text).toContain('Paper wallet')
    expect(text).not.toContain('%')
  })

  it('adds up the total once every balance is known', () => {
    const text = renderPage({ claims: [wallet], manual: [manualAccount], walletRows: [walletRow()] })
    expect(text).toContain('1.50000000 BTC')
    expect(text).toContain('$75,000.00')
    expect(text).toContain('33.3%')
    expect(text).toContain('Synced')
  })

  it('says when balances were last synced while a wallet is unreachable', () => {
    const text = renderPage({ claims: [wallet], walletRows: [walletRow({ failed: true, failure: 'unreachable' })] })
    expect(text).toContain('0.50000000 BTC')
    expect(text).toContain('Last synced')
  })

  it('holds the total back while an exchange balance has not been fetched yet', () => {
    const exchange: ExchangeAccountDto = {
      id: 'exchange-1',
      exchange: 'kraken',
      displayName: 'Kraken',
      currency: 'BTC',
      balance: null,
      balanceAsOf: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      connectionStatus: 'connected',
    }
    const text = renderPage({ exchanges: [exchange], manual: [manualAccount] })
    expect(text).toContain('Paper wallet')
    expect(text).not.toContain('%')
  })
})
