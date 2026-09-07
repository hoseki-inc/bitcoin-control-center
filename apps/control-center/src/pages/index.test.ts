import { ChakraProvider } from '@chakra-ui/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './index'

const mocks = vi.hoisted(() => ({
  accounts: { claims: [] as unknown[], exchange: [] as unknown[], manual: [] as unknown[], etf: [] as unknown[] },
  history: [] as Array<{ timestamp: string; totalBalance: string }>,
  isLoading: false,
  isError: false,
}))

vi.mock('../trpc', () => {
  const result = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })
  const accounts = (key: keyof typeof mocks.accounts) => ({
    list: { useQuery: () => ({ ...result(mocks.accounts[key]), isLoading: mocks.isLoading, isError: mocks.isError }) },
  })
  return {
    trpc: {
      portalProve: {
        statement: { list: { useQuery: () => result([]) } },
        registry: { claims: accounts('claims') },
        exchange: accounts('exchange'),
        manual: accounts('manual'),
        etf: accounts('etf'),
        controlCenter: {
          getData: {
            useQuery: () =>
              result({
                currentTotalBalance: '0',
                currentBtcPrice: '50000',
                historicalData: mocks.history,
                verifiedClaimsCount: 0,
                exchangeAccountCount: 0,
              }),
          },
        },
      },
    },
  }
})

vi.mock('../hooks/use-ui-settings', () => ({
  useUiSettings: () => ({ isStatementsMadeEasyDismissed: false, updateUiSettings: vi.fn() }),
}))
vi.mock('../components/dashboard/banner', () => ({
  Banner: () => createElement('div', null, 'Statement introduction'),
}))
vi.mock('../components/dashboard/recent-statements', () => ({ RecentStatements: () => null }))
vi.mock('../components/dashboard-charts/accumulation-chart', () => ({
  AccumulationChart: () => createElement('div', null, 'Balance chart'),
}))
vi.mock('@hoseki/packages/ui/design-system', async () => {
  const { EmptyView } = await import('@hoseki/packages/ui/design-system/empty-view')
  return {
    EmptyView,
    Spinner: () => createElement('div', null, 'Loading overview'),
    ErrorBanner: ({ message }: { message: string }) => createElement('div', { role: 'alert' }, message),
  }
})

function renderHome(): string {
  return renderToStaticMarkup(
    createElement(ChakraProvider, null, createElement(MemoryRouter, null, createElement(HomePage))),
  )
}

beforeEach(() => {
  mocks.accounts = { claims: [], exchange: [], manual: [], etf: [] }
  mocks.history = []
  mocks.isLoading = false
  mocks.isError = false
})

describe('Home overview states', () => {
  it('shows one account action without zero metrics, a chart, or a competing statement introduction', () => {
    const html = renderHome()
    expect(html).toContain('Your Bitcoin, in one place')
    expect(html.match(/href="\/accounts\/add"/g)).toHaveLength(1)
    for (const text of [
      '0.00000000',
      '0 verified',
      '30d Change',
      'Balance chart',
      'Generate Statement',
      'Statement introduction',
    ]) {
      expect(html).not.toContain(text)
    }
  })

  it.each(['claims', 'exchange', 'manual', 'etf'] as const)(
    'keeps a zero-balance %s account distinct from no accounts',
    (kind) => {
      mocks.accounts[kind] = [{ id: 'account', status: 'pending', balance: '0' }]
      const html = renderHome()
      expect(html).toContain('Your history will appear here')
      expect(html).toContain('href="/accounts"')
      expect(html).not.toContain('href="/accounts/add"')
      expect(html).not.toContain('0.00000000')
    },
  )

  it('keeps the dashboard available when history exists, including a zero balance', () => {
    mocks.history = [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '0' }]
    expect(renderHome()).toContain('Balance chart')
  })

  it('does not present failed account queries as an empty portfolio', () => {
    mocks.isError = true
    const html = renderHome()
    expect(html).toContain('role="alert"')
    expect(html).toContain('Try Again')
    expect(html).not.toContain('href="/accounts/add"')
  })

  it('waits for account queries before offering onboarding', () => {
    mocks.isLoading = true
    const html = renderHome()
    expect(html).toContain('Loading overview')
    expect(html).not.toContain('href="/accounts/add"')
  })
})
