// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  handOffAccountScan,
  readActiveAccountScan,
  resetXpubScanStore,
  subscribeAccountScan,
} from '../pages/claims/verify/xpub-scan-store'
import { forgetApp, lockApp, signIn, signOutEverywhere } from './actions'
import { INITIAL_GATE, dispatch, useGate } from './gate'
import { TAB_HEADER, tabId } from './tab'

const fetchMock = vi.fn<typeof fetch>()
const reload = vi.fn<() => void>()

function withTestSetup(): void {
  onTestFinished(() => {
    resetXpubScanStore()
    vi.unstubAllGlobals()
    useGate.setState(INITIAL_GATE, true)
  })
  useGate.setState({ ...INITIAL_GATE, phase: 'open' }, true)
  vi.stubGlobal('fetch', fetchMock.mockReset())
  vi.stubGlobal('location', { reload: reload.mockReset() })
}

function sent(call: number) {
  const [input, init] = fetchMock.mock.calls[call] ?? []
  const url = input instanceof Request ? input.url : (input?.toString() ?? '')
  return { route: url.split('/').at(-1) ?? '', tab: new Headers(init?.headers).get(TAB_HEADER) }
}

const done = (json: { ok: true } | null): Response => Response.json({ result: { data: { json } } })

describe('lockApp', () => {
  it('covers the app and gives the tab a new ID before Sentinel answers, then ends the old session', async () => {
    withTestSetup()
    let answer: (response: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const before = tabId()

    const locking = lockApp()
    expect(useGate.getState()).toMatchObject({ epoch: 1, phase: 'covering' })
    // While the lock is on its way, a reload or a new sign-in already uses the new ID.
    const during = tabId()
    expect(during).not.toBe(before)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    expect(sent(0)).toEqual({ route: 'auth.lock', tab: before })

    answer(done(null))
    await locking
    expect(tabId()).toBe(during)
  })

  it('gives the tab a new ID even when Sentinel never hears the lock', async () => {
    withTestSetup()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const before = tabId()
    await lockApp('once')
    expect(useGate.getState()).toMatchObject({ epoch: 1, phase: 'closed' })
    expect(tabId()).not.toBe(before)
  })
})

describe('signIn', () => {
  it('ends the session Sentinel opened for a sign-in that a lock overtook', async () => {
    withTestSetup()
    let answer: (response: Response) => void = () => {}
    fetchMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve
        }),
      )
      .mockResolvedValue(done(null))
    const signingIn = signIn('482915')
    const tab = tabId()
    dispatch({ type: 'lock', at: 'once' })
    answer(done({ ok: true }))
    await signingIn
    await vi.waitFor(() => {
      expect(sent(1)).toEqual({ route: 'auth.lock', tab })
    })
  })

  it('leaves the session of a sign-in that finished first', async () => {
    withTestSetup()
    fetchMock.mockResolvedValueOnce(done({ ok: true }))
    await signIn('482915')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('signOutEverywhere', () => {
  it('reloads once Sentinel confirms', async () => {
    withTestSetup()
    fetchMock.mockResolvedValueOnce(done(null))
    expect((await signOutEverywhere()).isOk()).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reports a failure and stays on the page', async () => {
    withTestSetup()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await signOutEverywhere()).isErr()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('forgetApp', () => {
  it('clears completed and active xpub scan entries and timers', async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    withTestSetup()

    const settledUpdates: Array<{ status: string }> = []
    const unsubSettled = subscribeAccountScan(
      'bitcoin_mainnet::wpkh(settled)',
      async () => ({ usedIndexes: [], balanceSats: '0' }),
      (state) => {
        settledUpdates.push(state)
      },
    )
    await vi.waitFor(() => {
      expect(settledUpdates.at(-1)).toEqual({ status: 'loaded', balanceSats: 0n })
    })
    unsubSettled()

    const unsubActive = subscribeAccountScan(
      'bitcoin_mainnet::wpkh(active)',
      async () => new Promise(() => undefined),
      () => undefined,
    )
    handOffAccountScan('bitcoin_mainnet::wpkh(active)')
    unsubActive()

    await vi.advanceTimersByTimeAsync(0)
    expect(readActiveAccountScan('bitcoin_mainnet::wpkh(settled)')).toEqual({ status: 'loaded', balanceSats: 0n })
    expect(readActiveAccountScan('bitcoin_mainnet::wpkh(active)')).toEqual({ status: 'loading' })
    expect(vi.getTimerCount()).toBe(2)

    await forgetApp()

    expect(readActiveAccountScan('bitcoin_mainnet::wpkh(settled)')).toBeUndefined()
    expect(readActiveAccountScan('bitcoin_mainnet::wpkh(active)')).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
