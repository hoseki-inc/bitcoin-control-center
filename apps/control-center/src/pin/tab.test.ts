import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { INITIAL_GATE, useGate } from './gate'
import { TAB_HEADER, continuesTab, retireTabId, sentinelFetch, tabId } from './tab'

const startedAt = 1_700_000_000_000

describe('continuesTab', () => {
  it('keeps the tab through a reload, however long the page takes to load', () => {
    // The old page leaves once the server answers: at once, or many seconds into a slow load.
    expect(continuesTab('reload', startedAt + 50, startedAt)).toBe(true)
    expect(continuesTab('reload', startedAt + 11_000, startedAt)).toBe(true)
    // Clock jitter can put the leave a moment before the start.
    expect(continuesTab('reload', startedAt - 300, startedAt)).toBe(true)
  })

  it('asks again for a closed tab that is reopened, even quickly or through a reload', () => {
    expect(continuesTab('reload', startedAt - 2000, startedAt)).toBe(false)
    expect(continuesTab('reload', startedAt - 60_000, startedAt)).toBe(false)
    expect(continuesTab('back_forward', startedAt + 50, startedAt)).toBe(false)
  })

  it('asks again for a duplicated or newly opened tab', () => {
    expect(continuesTab('navigate', null, startedAt)).toBe(false)
    expect(continuesTab('reload', null, startedAt)).toBe(false)
    expect(continuesTab(null, null, startedAt)).toBe(false)
  })

  it('goes by timing alone where the browser hides the navigation, as Tor Browser does', () => {
    expect(continuesTab(null, startedAt + 50, startedAt)).toBe(true)
    expect(continuesTab(null, startedAt - 60_000, startedAt)).toBe(false)
  })

  it('ignores a leave time far in the future', () => {
    expect(continuesTab('reload', startedAt + 60 * 60 * 1000, startedAt)).toBe(false)
  })
})

describe('sentinelFetch', () => {
  it('sends this tab’s ID and the cookie, unless the request names another tab', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    await sentinelFetch('/trpc/auth.status')
    await sentinelFetch('/trpc/auth.lock', { headers: { [TAB_HEADER]: 'tab-retiredretiredre' } })
    const sent = fetchMock.mock.calls.map(([, init]) => [new Headers(init?.headers).get(TAB_HEADER), init?.credentials])
    expect(sent).toEqual([
      [tabId(), 'include'],
      ['tab-retiredretiredre', 'include'],
    ])
  })

  it('locks when Sentinel says this tab needs the PIN, but not for a tab ID it retired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 })),
    )
    onTestFinished(() => {
      vi.unstubAllGlobals()
      useGate.setState(INITIAL_GATE, true)
    })
    useGate.setState({ ...INITIAL_GATE, phase: 'open' }, true)
    const retired = retireTabId()
    await sentinelFetch('/trpc/auth.lock', { headers: { [TAB_HEADER]: retired } })
    expect(useGate.getState()).toMatchObject({ epoch: 0, phase: 'open' })

    await sentinelFetch('/trpc/accounts.list')
    expect(useGate.getState()).toMatchObject({ epoch: 1, phase: 'covering' })
  })

  it('gives the tab a new ID when it locks, so a late answer to an earlier request locks nothing', async () => {
    const answers: ((response: Response) => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Promise((resolve) => {
            answers.push(resolve)
          }),
      ),
    )
    onTestFinished(() => {
      vi.unstubAllGlobals()
      useGate.setState(INITIAL_GATE, true)
    })
    useGate.setState({ ...INITIAL_GATE, phase: 'open' }, true)
    const before = tabId()
    const first = sentinelFetch('/trpc/accounts.list')
    const late = sentinelFetch('/trpc/settings.get')
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2)
    })

    answers[0]?.(new Response('{}', { status: 401 }))
    await first
    expect(useGate.getState().epoch).toBe(1)
    expect(tabId()).not.toBe(before)

    // The user signs in again under the new ID before the second answer arrives.
    useGate.setState({ ...INITIAL_GATE, epoch: 1, phase: 'open' }, true)
    answers[1]?.(new Response('{}', { status: 401 }))
    await late
    expect(useGate.getState()).toMatchObject({ epoch: 1, phase: 'open' })
  })
})
