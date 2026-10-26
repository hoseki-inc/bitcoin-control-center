// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../testing/trpc'
import { trpc } from '../trpc'
import { useWalletBalances } from './wallet-balances'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const snapshotAsOf = '2026-10-25T09:00:00.000Z'
const scannedAsOf = '2026-10-25T12:00:00.000Z'

function Portfolio(): null {
  trpc.portalProve.controlCenter.getData.useQuery({ timeRange: '30d' })
  useWalletBalances(['a'], { enabled: true })
  return null
}

it('reads the portfolio again when a wallet scan finishes during its first read', async () => {
  const portfolioReads: Array<(walletBalancesAsOf: Record<string, string>) => void> = []
  const rpc = createTestTrpcClient(async ({ path }) => {
    if (path === 'portalProve.controlCenter.walletBalances') {
      // The scan already finished: the wallet's balance is newer than the snapshot the read counts.
      return [{ accountId: 'a', balanceSats: '200', asOf: scannedAsOf, syncing: false, failed: false }]
    }
    if (path === 'portalProve.controlCenter.getData') {
      return new Promise((resolve) => {
        portfolioReads.push((walletBalancesAsOf) => {
          resolve({ currentTotalBalance: '100', walletBalancesAsOf })
        })
      })
    }
    throw new Error(`Unexpected request: ${path}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRoot(document.createElement('div'))
  onTestFinished(() => {
    act(() => {
      root.unmount()
    })
    client.clear()
  })

  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <Portfolio />
      </TestTrpcProvider>,
    )
  })
  await vi.waitFor(() => {
    expect(portfolioReads).toHaveLength(1)
  })
  // The first read answers with the snapshot it counted before the scan finished.
  await act(async () => {
    portfolioReads[0]?.({ a: snapshotAsOf })
  })
  await vi.waitFor(() => {
    expect(portfolioReads).toHaveLength(2)
  })

  // If Sentinel still counts the snapshot, the page doesn't keep asking.
  await act(async () => {
    portfolioReads[1]?.({ a: snapshotAsOf })
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  })
  expect(portfolioReads).toHaveLength(2)
})
