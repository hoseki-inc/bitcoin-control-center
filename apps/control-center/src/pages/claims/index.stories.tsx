import { Box, Button, HStack } from '@chakra-ui/react'
import { QueryClient } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { claimFixture } from '../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { DashboardPage } from '../dashboard'
import { HomePage } from '../index'
import { ClaimsPage } from './index'

type Scenario = 'initial' | 'saved' | 'partial' | 'price-unavailable' | 'zero'
interface PreviewProps {
  scenario: Scenario
}
const walletId = 're_clmx_preview'
const timestamp = '2026-10-14T15:42:00Z'

function HoldingsPreview({ scenario }: PreviewProps): JSX.Element {
  const [page, setPage] = useState<'accounts' | 'home' | 'portfolio'>('accounts')
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  )
  const [rpc] = useState(() =>
    createTestTrpcClient(async ({ path }) => {
      switch (path) {
        case 'portalProve.registry.claims.list':
          return [claimFixture(walletId, 'Long-term savings')]
        case 'portalProve.retrieveBitcoinPriceHistory':
          return {
            points: [
              { time: Date.parse('2026-10-01T00:00:00Z') / 1000, value: 90000 },
              { time: Date.parse(timestamp) / 1000, value: 95000 },
            ],
            quoteCurrency: 'USD',
            historySources: ['Preview'],
          }
        case 'portalProve.statement.list':
          return []
        case 'portalProve.controlCenter.recordSnapshot':
          return undefined
        case 'portalProve.controlCenter.getData': {
          const complete = scenario !== 'initial' && scenario !== 'partial'
          const total = scenario === 'zero' ? '30000000' : '155000000'
          return {
            currentTotalBalance: complete ? total : null,
            knownTotalBalance: complete ? total : '30000000',
            balanceStatus: {
              complete,
              missingAccountIds: complete ? [] : [walletId],
              staleAccountIds: scenario === 'saved' ? [walletId] : [],
              asOf: timestamp,
            },
            currentBtcPrice: scenario === 'price-unavailable' ? null : '95000',
            priceStatus: null,
            verifiedClaimsCount: 1,
            exchangeAccountCount: 0,
            manualAccountCount: 1,
            etfAccountCount: 0,
            historicalData: [
              { timestamp: '2026-10-01T12:00:00Z', totalBalance: '30000000' },
              { timestamp, totalBalance: total },
            ],
            historySyncingAccountIds: [],
            historySyncedAccountIds: [],
            historyRefreshingAccountIds: [],
            historyFailedAccountIds: [],
          }
        }
        case 'portalProve.registry.claims.listArchived':
        case 'portalProve.exchange.list':
        case 'portalProve.etf.list':
          return []
        case 'portalProve.manual.list':
          return [
            {
              id: 'manual',
              displayName: 'Cold storage',
              balance: '30000000',
              balanceAsOf: timestamp,
              createdAt: timestamp,
              currency: 'BTC',
            },
          ]
        case 'portalProve.controlCenter.storedWalletBalances':
          return scenario === 'saved' ? [{ accountId: walletId, balanceSats: '125000000', timestamp }] : []
        case 'portalProve.onchain.claimBalances':
          if (scenario === 'initial') {
            return new Promise<never>(() => undefined)
          }
          if (scenario === 'saved' || scenario === 'partial') {
            throw new Error('Electrum unavailable')
          }
          return new Map([[walletId, new Decimal(scenario === 'zero' ? 0 : 125000000)]])
        case 'portalProve.retrieveBitcoinPrice':
          if (scenario === 'price-unavailable') {
            throw new Error('Price unavailable')
          }
          return { value: new Decimal(95_000), source: 'block', lastKnown: false, asOf: new Date(timestamp) }
        case 'portalProve.exchange.refreshAllBalances':
          return undefined
        default:
          throw new Error(`Unexpected preview request: ${path}`)
      }
    }),
  )
  return (
    <TestTrpcProvider client={client} rpc={rpc}>
      <MemoryRouter>
        <Box maxW="1100px" mx="auto" px={{ base: 4, md: 8 }}>
          <HStack pt={4} gap={2}>
            {(['accounts', 'home', 'portfolio'] as const).map((view) => (
              <Button
                key={view}
                size="sm"
                variant={page === view ? 'solid' : 'outline'}
                onClick={() => {
                  setPage(view)
                }}
              >
                {view === 'accounts' ? 'My Holdings' : view === 'home' ? 'Home' : 'Portfolio'}
              </Button>
            ))}
          </HStack>
          {page === 'accounts' ? <ClaimsPage /> : page === 'home' ? <HomePage /> : <DashboardPage />}
        </Box>
      </MemoryRouter>
    </TestTrpcProvider>
  )
}

export function InitialLoad(): JSX.Element {
  return <HoldingsPreview scenario="initial" />
}
export function SavedBalance(): JSX.Element {
  return <HoldingsPreview scenario="saved" />
}
export function PartialBalances(): JSX.Element {
  return <HoldingsPreview scenario="partial" />
}
export function PriceUnavailable(): JSX.Element {
  return <HoldingsPreview scenario="price-unavailable" />
}
export function ConfirmedZero(): JSX.Element {
  return <HoldingsPreview scenario="zero" />
}
