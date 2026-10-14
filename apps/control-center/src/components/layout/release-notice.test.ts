// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactElement, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { DOWNLOAD_URL, PENDING_REFRESH_MS, ReleaseNotice } from './release-notice'

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

/** A fake Sentinel holding the release it found. */
class ReleaseServer {
  public newVersion: string | null = null
  public pending = false

  public constructor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
    fetchMock.mockImplementation(async (input) => {
      const url = parseUnknown(z.string(), input).unwrapOr('')
      const json = url.includes('/settings.releaseCheck')
        ? { newVersion: this.newVersion, pending: this.pending }
        : null
      return Response.json({ result: { data: { json } } })
    })
  }
}

async function render(
  element: () => ReactElement,
  setup: (server: ReleaseServer) => void = () => undefined,
): Promise<{ server: ReleaseServer; container: HTMLDivElement; remount: () => Promise<void> }> {
  const dom = browser.acquire()
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const server = new ReleaseServer(fetchMock)
  setup(server)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  let root: Root = createRoot(container)
  const mount = async (): Promise<void> => {
    const updates = queryClient.getQueryState(['release-check'])?.dataUpdateCount ?? 0
    await act(async () => {
      root.render(
        createElement(ChakraProvider, null, createElement(QueryClientProvider, { client: queryClient }, element())),
      )
    })
    // Wait for this mount's status request to answer.
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(queryClient.getQueryState(['release-check'])?.dataUpdateCount).toBeGreaterThan(updates)
    })
    // Render what arrived.
    await act(async () => {})
  }
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
  await mount()
  return {
    server,
    container,
    // The notice mounted again, as on a page outside the main layout; the app itself keeps running.
    remount: async (): Promise<void> => {
      await act(async () => {
        root.unmount()
      })
      root = createRoot(container)
      await queryClient.invalidateQueries()
      await mount()
    },
  }
}

/** Waits for React to render what the fake Sentinel answered. */
async function eventually(check: () => void): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {})
    check()
  })
}

it('shows nothing until a newer release is found', async () => {
  const { container } = await render(() => createElement(ReleaseNotice))
  await eventually(() => {
    expect(container.textContent).toBe('')
  })
})

it('says which release is out and links to the website to download it', async () => {
  const { container } = await render(
    () => createElement(ReleaseNotice),
    (server) => {
      server.newVersion = '0.6.0'
    },
  )
  await eventually(() => {
    expect(container.textContent).toContain('Bitcoin Control Center 0.6.0 is available.')
  })
  const link = container.querySelector<HTMLAnchorElement>('a')
  expect(link?.textContent).toBe('Download')
  expect(link?.href).toBe(DOWNLOAD_URL)
  expect(link?.target).toBe('_blank')
})

it('stays dismissed until a newer release is found', async () => {
  const { container, server, remount } = await render(
    () => createElement(ReleaseNotice),
    (fake) => {
      fake.newVersion = '0.7.0'
    },
  )
  await eventually(() => {
    expect(container.textContent).toContain('Bitcoin Control Center 0.7.0 is available.')
  })
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')?.click()
  })
  await eventually(() => {
    expect(container.textContent).toBe('')
  })
  await remount()
  await eventually(() => {
    expect(container.textContent).toBe('')
  })
  server.newVersion = '0.7.1'
  await remount()
  await eventually(() => {
    expect(container.textContent).toContain('Bitcoin Control Center 0.7.1 is available.')
  })
})

it('asks again soon while the launch check is still running, so a short session sees its result', async () => {
  const { container, server } = await render(
    () => createElement(ReleaseNotice),
    (fake) => {
      fake.pending = true
    },
  )
  expect(container.textContent).toBe('')
  server.pending = false
  server.newVersion = '0.8.0'
  await vi.waitFor(
    async () => {
      await act(async () => {})
      expect(container.textContent).toContain('Bitcoin Control Center 0.8.0 is available.')
    },
    { timeout: PENDING_REFRESH_MS + 2000, interval: 100 },
  )
})

it('keeps an empty live region in place, so the notice is announced when it appears', async () => {
  const { container } = await render(() => createElement(ReleaseNotice))
  const region = container.querySelector('output')
  expect(region).not.toBeNull()
  expect(region?.textContent).toBe('')
})

it('keeps the keyboard in the page after dismissing with the keyboard, and leaves mouse focus alone', async () => {
  const { container, server, remount } = await render(
    () => createElement(ReleaseNotice),
    (fake) => {
      fake.newVersion = '0.9.0'
    },
  )
  // The layout's main content, which takes focus without a tab stop.
  const main = document.createElement('main')
  main.id = 'main-content'
  main.tabIndex = -1
  document.body.append(main)
  const dismiss = (detail: number): void => {
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')
    button?.focus()
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
  }
  await eventually(() => {
    expect(container.textContent).toContain('0.9.0')
  })
  await act(async () => {
    dismiss(1)
  })
  expect(document.activeElement).not.toBe(main)

  server.newVersion = '0.9.1'
  await remount()
  await eventually(() => {
    expect(container.textContent).toContain('0.9.1')
  })
  await act(async () => {
    dismiss(0)
  })
  expect(document.activeElement).toBe(main)
})
