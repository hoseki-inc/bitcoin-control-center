// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { lockApp, signOutEverywhere } from './actions'
import { TAB_HEADER, currentEpoch, sentinelFetch, tabId, useGate } from './session'

const fetchMock = vi.fn<typeof fetch>()
const reload = vi.fn<() => void>()

function withTestSetup(): void {
  onTestFinished(() => {
    vi.unstubAllGlobals()
    useGate.setState({ epoch: 0, app: 'checking', setupEpoch: null })
  })
  vi.stubGlobal('fetch', fetchMock.mockReset())
  vi.stubGlobal('location', { reload: reload.mockReset() })
}

function sentTabId(call: number): string | null {
  const init = fetchMock.mock.calls[call]?.[1]
  return new Headers(init?.headers).get(TAB_HEADER)
}

const done = (): Response => Response.json({ result: { data: { json: null } } })

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
    expect(currentEpoch()).toBe(1)
    // While the lock is on its way, a reload or a new sign-in already uses the new ID.
    const during = tabId()
    expect(during).not.toBe(before)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    expect(sentTabId(0)).toBe(before)

    answer(done())
    await locking
    expect(tabId()).toBe(during)
  })

  it('gives the tab a new ID even when Sentinel never hears the lock', async () => {
    withTestSetup()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const before = tabId()

    await lockApp()
    expect(currentEpoch()).toBe(1)
    expect(tabId()).not.toBe(before)
  })
})

describe('signOutEverywhere', () => {
  it('reloads once Sentinel confirms', async () => {
    withTestSetup()
    fetchMock.mockResolvedValueOnce(done())
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

describe('sentinelFetch', () => {
  it('locks when Sentinel refuses this tab, but not when it refuses a tab already retired', async () => {
    withTestSetup()
    const refused = (): Response => Response.json({}, { status: 401 })
    fetchMock.mockImplementation(async () => refused())

    await sentinelFetch('/trpc/auth.lock', { headers: { [TAB_HEADER]: 'retired-tab-aaaaaaaa' } })
    expect(currentEpoch()).toBe(0)

    await sentinelFetch('/trpc/settings.get')
    expect(currentEpoch()).toBe(1)
  })
})
