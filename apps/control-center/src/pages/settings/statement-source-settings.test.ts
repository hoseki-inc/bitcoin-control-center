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
  /** Fails reading the source back, as a request lost after a save would. */
  public failRead = false
  /** Holds each request until the test releases it, so a change can land at an exact point. */
  public hold = false
  public readonly held: { kind: 'read' | 'save'; source?: string; release: () => void }[] = []
  public readonly saved: string[] = []

  public constructor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
    fetchMock.mockImplementation(async (input, init) => {
      const url = parseUnknown(z.string(), input).unwrapOr('')
      if (this.hold) {
        const kind = url.endsWith('/settings.setStatementSource') ? 'save' : 'read'
        const source =
          kind === 'save'
            ? parseUnknown(SavedSchema, JSON.parse(parseUnknown(z.string(), init?.body).unwrapOr('null')))
                .map((body) => body.json.source)
                .unwrapOr(undefined)
            : undefined
        await new Promise<void>((resolve) => {
          this.held.push({ kind, source, release: resolve })
        })
      }
      if (url.includes('/settings.statementSource')) {
        if (this.failRead) {
          return Response.json(
            { error: { json: { message: 'Sentinel is restarting', code: -32603 } } },
            { status: 500 },
          )
        }
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

async function renderSettings({ torEnabled = false, selectable = true, failRead = false } = {}): Promise<{
  server: SourceServer
  container: HTMLDivElement
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
}> {
  const dom = browser.acquire()
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(toast, 'error').mockReturnValue('test-toast')
  const server = new SourceServer(fetchMock)
  server.selectable = selectable
  server.failRead = failRead
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
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(StatementSourceSettings, { torEnabled }),
        ),
      ),
    )
  })
  if (selectable && !failRead) {
    await settle(container)
  }
  return { server, container, fetchMock }
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

/** Waits for the next held request to be the one given, then lets it through. */
async function release(server: SourceServer, kind: 'read' | 'save', source?: string): Promise<void> {
  await vi.waitFor(() => {
    expect(server.held[0]).toMatchObject(source === undefined ? { kind } : { kind, source })
  })
  const request = server.held.shift()
  await act(async () => {
    request?.release()
  })
}

async function choose(container: HTMLDivElement, value: 'mempool' | 'electrum'): Promise<void> {
  await act(async () => {
    radio(container, value).click()
  })
}

it('shows the saved source and what it shares', async () => {
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
  const { container } = await renderSettings({ torEnabled: true })
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
  server.hold = true
  await choose(container, 'electrum')
  await vi.waitFor(() => {
    expect(server.held).toMatchObject([{ kind: 'save', source: 'electrum' }])
  })
  // Waits behind the save of Electrum, which is still running.
  await choose(container, 'mempool')
  await release(server, 'save', 'electrum')
  await release(server, 'save', 'mempool')
  await release(server, 'read')
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.textContent).toContain('Statement source saved')
  })
  expect(server.saved).toEqual(['electrum', 'mempool'])
  expect(server.source).toBe('mempool')
  expect(radio(container, 'mempool').checked).toBe(true)
})

it('confirms only the last choice when one is made while the previous is read back', async () => {
  const { server, container } = await renderSettings()
  server.hold = true
  await choose(container, 'electrum')
  await release(server, 'save', 'electrum')
  await vi.waitFor(() => {
    expect(server.held).toMatchObject([{ kind: 'read' }])
  })
  // Electrum is saved and being read back.
  await choose(container, 'mempool')
  await release(server, 'read')
  await vi.waitFor(() => {
    expect(server.held).toMatchObject([{ kind: 'save', source: 'mempool' }])
  })
  expect(container.textContent).not.toContain('Statement source saved')
  expect(radio(container, 'mempool').checked).toBe(true)
  await release(server, 'save', 'mempool')
  await release(server, 'read')
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.textContent).toContain('Statement source saved')
  })
  expect(server.saved).toEqual(['electrum', 'mempool'])
  expect(radio(container, 'mempool').checked).toBe(true)
})

it('keeps a saved choice when reading it back fails', async () => {
  const { server, container } = await renderSettings()
  server.failRead = true
  await choose(container, 'electrum')
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.textContent).toContain('Statement source saved')
  })
  expect(server.source).toBe('electrum')
  expect(radio(container, 'electrum').checked).toBe(true)
  expect(container.textContent).toContain('shared with the server operator')
  // The save worked, so there's no load error to report.
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it('names the choices and reads what the chosen one shares with it', async () => {
  const { container } = await renderSettings({ torEnabled: true })
  const group = container.querySelector('[role="radiogroup"]')
  const label = document.getElementById(group?.getAttribute('aria-labelledby') ?? '')
  expect(label?.textContent).toBe('Look up transactions on')
  expect(radio(container, 'mempool').getAttribute('aria-describedby')).toBe('statement-source-help')
  // The help line is about the chosen source, so it doesn't describe the other one.
  expect(radio(container, 'electrum').hasAttribute('aria-describedby')).toBe(false)
  await choose(container, 'electrum')
  expect(radio(container, 'mempool').hasAttribute('aria-describedby')).toBe(false)
  const described = radio(container, 'electrum').getAttribute('aria-describedby')?.split(' ') ?? []
  expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
    'Slower. Your transaction details are shared with the server operator.',
    'Your current Electrum connection uses Tor, so statement generation could take several minutes.',
  ])
})

it("says when the source can't load and keeps the choices disabled", async () => {
  const { server, container } = await renderSettings({ failRead: true })
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not load statement settings. Refresh to try again.',
    )
  })
  expect(radio(container, 'mempool').disabled).toBe(true)
  expect(radio(container, 'electrum').disabled).toBe(true)
  await act(async () => {
    radio(container, 'electrum').closest('label')?.click()
  })
  expect(server.saved).toEqual([])
})

it('is hidden where Sentinel does not let the source be chosen', async () => {
  const { container, fetchMock } = await renderSettings({ selectable: false })
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalled()
    expect(container.textContent).toBe('')
  })
})
