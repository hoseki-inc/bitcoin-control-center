// @vitest-environment jsdom
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { useLocalSetting } from './use-local-settings'

const fetchMock = vi.fn<typeof fetch>()
const queryKey = ['local-settings', 'user_name']
let client: QueryClient
let root: Root
let container: HTMLDivElement

function Probe(): React.ReactElement {
  const setting = useLocalSetting('user_name')
  return createElement(
    'button',
    {
      onClick: () => {
        setting.save('Updated name')
      },
    },
    JSON.stringify(setting.data),
  )
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  vi.stubGlobal('fetch', fetchMock.mockReset())
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: vi.fn<() => void>(), warn: vi.fn<() => void>(), error: vi.fn<() => void>() },
  })
  container = document.createElement('div')
  root = createRoot(container)

  await run()
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe)))
  })
}

it.each(['Saved name', '', null])('decodes the setting value %j through the API client', async (value) => {
  await withTestSetup(async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ result: { data: { json: value } } }))
    await render()
    await act(async () => {
      await vi.waitFor(() => {
        expect(client.getQueryData(queryKey)).toBe(value)
      })
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toBe(JSON.stringify(value))
    })
    const [url, options] = fetchMock.mock.calls[0] ?? []
    const requestUrl = new URL(parseUnknown(z.string(), url).expect('Expected a settings URL'), 'http://localhost')
    expect(requestUrl.pathname).toBe('/settings.get')
    expect(requestUrl.searchParams.get('input')).toBe(JSON.stringify({ json: { key: 'user_name' } }))
    expect(options?.method).toBe('GET')
  })
})

it.each([
  ['server error', JSON.stringify({ error: { json: { message: 'Forbidden', code: -32003 } } }), 403],
  ['invalid JSON', '<html>Unavailable</html>', 502],
  ['malformed response', '{}', 200],
] as const)('treats %s as a failed query', async (_label, body, status) => {
  await withTestSetup(async () => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status }))
    await render()
    await act(async () => {
      await vi.waitFor(() => {
        expect(client.getQueryState(queryKey)?.status).toBe('error')
      })
    })
    expect(client.getQueryData(queryKey)).toBeUndefined()
  })
})

it('refreshes the same cached setting after saving', async () => {
  await withTestSetup(async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ result: { data: { json: 'Old name' } } }))
      .mockResolvedValueOnce(Response.json({ result: { data: { json: null } } }))
      .mockResolvedValueOnce(Response.json({ result: { data: { json: 'Updated name' } } }))
    await render()
    await act(async () => {
      await vi.waitFor(() => {
        expect(client.getQueryData(queryKey)).toBe('Old name')
      })
    })
    await act(async () => {
      container.querySelector('button')?.click()
      await vi.waitFor(() => {
        expect(client.getQueryData(queryKey)).toBe('Updated name')
      })
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toBe(JSON.stringify('Updated name'))
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/settings.update'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ json: { key: 'user_name', value: 'Updated name' } }),
      }),
    )
  })
})
