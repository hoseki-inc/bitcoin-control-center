import { Box } from '@chakra-ui/react'
import { QueryClient } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { claimFixture } from '../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { ClaimsPage } from './index'

type Scenario = 'initial' | 'saved' | 'partial' | 'price-unavailable' | 'zero'
interface PreviewProps {
  scenario: Scenario
}
const walletId = 're_clmx_preview'
const timestamp = '2026-10-14T15:42:00Z'

function HoldingsPreview({ scenario }: PreviewProps): JSX.Element {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  )
  const [rpc] = useState(() =>
    createTestTrpcClient(async ({ path }) => {
      switch (path) {
        case 'portalProve.registry.claims.list':
          return [claimFixture(walletId, 'Long-term savings')]
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
          <ClaimsPage />
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
