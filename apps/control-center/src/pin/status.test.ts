// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { TAB_HEADER, tabId, useLockState } from './session'
import { lockApp, signOutEverywhere } from './status'

const fetchMock = vi.fn<typeof fetch>()
const reload = vi.fn<() => void>()

function withTestSetup(): void {
  onTestFinished(() => {
    vi.unstubAllGlobals()
    useLockState.getState().unlock()
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
  it('covers the app before Sentinel answers, then gives the tab a new ID', async () => {
    withTestSetup()
    let answer: (response: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const before = tabId()

    const locking = lockApp()
    expect(useLockState.getState().locked).toBe(true)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    expect(sentTabId(0)).toBe(before)

    answer(done())
    await locking
    expect(tabId()).not.toBe(before)
  })

  it('gives the tab a new ID even when Sentinel never hears the lock', async () => {
    withTestSetup()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const before = tabId()

    await lockApp()
    expect(useLockState.getState().locked).toBe(true)
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
