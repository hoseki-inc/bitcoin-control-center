// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { StatementSourceSettings } from './statement-source-settings'

const browser = await vi.hoisted(async () => {
  const { createBrowserDom, installBrowserDom } = await import('@hoseki/packages/testing/browser-dom')
  let initialDom: ReturnType<typeof createBrowserDom> | undefined = createBrowserDom()
  installBrowserDom(initialDom)
  return {
    acquire: () => {
      const dom = initialDom ?? createBrowserDom()
      initialDom = undefined
      installBrowserDom(dom)
      return dom
    },
  }
})

const SavedSchema = z.object({ json: z.object({ source: z.enum(['mempool', 'electrum']) }) })

/** A fake Sentinel holding the statement source. */
class SourceServer {
  public source: 'mempool' | 'electrum' = 'mempool'
  public selectable = true
  public failSave = false
  public readonly saved: string[] = []

  public constructor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
    fetchMock.mockImplementation(async (input, init) => {
      const url = parseUnknown(z.string(), input).unwrapOr('')
      if (url.includes('/settings.statementSource')) {
        return Response.json({ result: { data: { json: { selectable: this.selectable, source: this.source } } } })
      }
      if (url.endsWith('/settings.setStatementSource')) {
        const body = parseUnknown(SavedSchema, JSON.parse(parseUnknown(z.string(), init?.body).unwrapOr('null')))
        const { source } = body.expect('saved source').json
        this.saved.push(source)
        if (this.failSave) {
          return Response.json(
            { error: { json: { message: 'Sentinel is restarting', code: -32603 } } },
            { status: 500 },
          )
        }
        this.source = source
        return Response.json({ result: { data: { json: null } } })
      }
      return Response.json({ result: { data: { json: null } } })
    })
  }
}

async function renderSettings(torEnabled = false): Promise<{ server: SourceServer; container: HTMLDivElement }> {
  const dom = browser.acquire()
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(toast, 'error').mockReturnValue('test-toast')
  const server = new SourceServer(fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  const render = async (tor: boolean): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(StatementSourceSettings, { torEnabled: tor }),
          ),
        ),
      )
    })
  }
  await render(torEnabled)
  await settle(container)
  return { server, container }
}

async function settle(container: HTMLDivElement): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.querySelector('input[value="mempool"]:not(:disabled)')).not.toBeNull()
  })
}

function radio(container: HTMLDivElement, value: 'mempool' | 'electrum'): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[value="${value}"]`)
  if (input === null) {
    throw new Error(`No ${value} option`)
  }
  return input
}

async function choose(container: HTMLDivElement, value: 'mempool' | 'electrum'): Promise<void> {
  await act(async () => {
    radio(container, value).click()
  })
}

it('shows the saved source with what each choice shares', async () => {
  const { container } = await renderSettings()
  expect(radio(container, 'mempool').checked).toBe(true)
  expect(container.textContent).toContain('Fastest · Default')
  expect(container.textContent).toContain('Configured Electrum server')
  expect(container.textContent).toContain(
    'Fastest. Your IP address and transaction details are shared with mempool.space.',
  )
})

it('saves the Electrum server and says the operator sees your IP without Tor', async () => {
  const { server, container } = await renderSettings()
  await choose(container, 'electrum')
  await vi.waitFor(() => {
    expect(server.saved).toEqual(['electrum'])
  })
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.textContent).toContain('Statement source saved')
  })
  expect(radio(container, 'electrum').checked).toBe(true)
  expect(container.textContent).toContain(
    'Slower. Your IP address and transaction details are shared with the server operator.',
  )
  expect(container.textContent).not.toContain('uses Tor')
})

it('leaves out your IP and warns about the wait when the connection uses Tor', async () => {
  const { container } = await renderSettings(true)
  expect(container.textContent).not.toContain('uses Tor')
  await choose(container, 'electrum')
  expect(container.textContent).toContain('Slower. Your transaction details are shared with the server operator.')
  expect(container.textContent).toContain(
    'Your current Electrum connection uses Tor, so statement generation could take several minutes.',
  )
})

it('says when saving fails and shows the saved source again', async () => {
  const { server, container } = await renderSettings()
  server.failSave = true
  await choose(container, 'electrum')
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(toast.error).toHaveBeenCalledWith('Could not save the statement source. Please try again.')
  })
  expect(radio(container, 'mempool').checked).toBe(true)
})

it('saves the last of several quick changes', async () => {
  const { server, container } = await renderSettings()
  await choose(container, 'electrum')
  await choose(container, 'mempool')
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.textContent).toContain('Statement source saved')
  })
  expect(server.source).toBe('mempool')
  expect(radio(container, 'mempool').checked).toBe(true)
})

it('is hidden where Sentinel does not let the source be chosen', async () => {
  const dom = browser.acquire()
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const server = new SourceServer(fetchMock)
  server.selectable = false
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(StatementSourceSettings, { torEnabled: false }),
        ),
      ),
    )
  })
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalled()
    expect(container.textContent).toBe('')
  })
})
