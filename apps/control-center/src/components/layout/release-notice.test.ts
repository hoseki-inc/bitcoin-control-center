// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactElement, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { ReleaseNotice } from './release-notice'

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
  /** How many times the window asked for the status. */
  public asked = 0

  public constructor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
    fetchMock.mockImplementation(async (input) => {
      const url = parseUnknown(z.string(), input).unwrapOr('')
      const status = url.includes('/settings.releaseCheck')
      if (status) {
        this.asked += 1
      }
      const json = status ? { newVersion: this.newVersion, pending: this.pending } : null
      return Response.json({ result: { data: { json } } })
    })
  }
}

interface Rendered {
  server: ReleaseServer
  container: HTMLDivElement
  remount: () => Promise<void>
  /** Status requests so far. */
  asked: () => number
}

async function render(
  element: () => ReactElement,
  setup: (server: ReleaseServer) => void = () => undefined,
): Promise<Rendered> {
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
    asked: () => server.asked,
    // The notice mounted again, as when moving to another page group; the app itself keeps running.
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
  expect(link?.href).toBe('https://www.bitcoincontrolcenter.com/#downloads')
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

it('asks every three seconds while the launch check runs, then hourly once it has finished', async () => {
  // Only the refetch timer is faked; React Query's own scheduling keeps running.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const { container, server, asked } = await render(
    () => createElement(ReleaseNotice),
    (fake) => {
      fake.pending = true
    },
  )
  const askAfter = async (ms: number): Promise<number> => {
    const before = asked()
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
    await eventually(() => {
      expect(asked()).toBeGreaterThanOrEqual(before)
    })
    return asked() - before
  }
  await expect(askAfter(3000)).resolves.toBe(1)
  await expect(askAfter(3000)).resolves.toBe(1)
  server.pending = false
  server.newVersion = '0.8.0'
  await expect(askAfter(3000)).resolves.toBe(1)
  await eventually(() => {
    expect(container.textContent).toContain('Bitcoin Control Center 0.8.0 is available.')
  })
  await expect(askAfter(10 * 60 * 1000)).resolves.toBe(0)
  await expect(askAfter(50 * 60 * 1000)).resolves.toBe(1)
})

it('keeps an empty live region in place, so the notice is announced when it appears', async () => {
  const { container } = await render(() => createElement(ReleaseNotice))
  const region = container.querySelector('output')
  expect(region).not.toBeNull()
  expect(region?.textContent).toBe('')
})

function controls(names: string[]): HTMLButtonElement[] {
  return names.map((name) => {
    const button = document.createElement('button')
    button.textContent = name
    // jsdom has no layout: give the control one box, so it counts as shown.
    button.getClientRects = (): DOMRectList => {
      const box: DOMRect = {
        x: 0,
        y: 0,
        width: 80,
        height: 24,
        top: 0,
        left: 0,
        right: 80,
        bottom: 24,
        toJSON: () => ({}),
      }
      return { length: 1, item: () => box, 0: box, [Symbol.iterator]: () => [box].values() }
    }
    document.body.prepend(button)
    onTestFinished(() => {
      button.remove()
    })
    return button
  })
}

function dismissButton(container: HTMLDivElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')
  if (button === null) {
    throw new Error('No Dismiss button')
  }
  return button
}

/** Tab from a control into the notice's Dismiss button, then activate it. */
async function dismissFrom(control: HTMLElement | null, container: HTMLDivElement, detail: number): Promise<void> {
  await act(async () => {
    control?.focus()
    dismissButton(container).focus()
    dismissButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
  })
}

it('returns keyboard focus to the control used before the notice, and leaves mouse focus alone', async () => {
  const { container, server, remount } = await render(
    () => createElement(ReleaseNotice),
    (fake) => {
      fake.newVersion = '0.9.0'
    },
  )
  const [later, earlier] = controls(['Later', 'Earlier'])
  await eventually(() => {
    expect(container.textContent).toContain('0.9.0')
  })
  // A mouse click (one pointer click) does not move focus anywhere.
  await dismissFrom(earlier ?? null, container, 1)
  expect(document.activeElement).not.toBe(earlier)

  server.newVersion = '0.9.1'
  await remount()
  await eventually(() => {
    expect(container.textContent).toContain('0.9.1')
  })
  // Enter or Space (no pointer clicks) returns to where the user came from, not the nearest control.
  await dismissFrom(earlier ?? null, container, 0)
  expect(document.activeElement).toBe(earlier)
  expect(document.activeElement).not.toBe(later)
})

it('falls back to the control just before the notice when the one used before is gone', async () => {
  const { container } = await render(
    () => createElement(ReleaseNotice),
    (fake) => {
      fake.newVersion = '0.9.2'
    },
  )
  const [nearest, gone] = controls(['Nearest', 'Gone'])
  await eventually(() => {
    expect(container.textContent).toContain('0.9.2')
  })
  await act(async () => {
    gone?.focus()
    dismissButton(container).focus()
    gone?.remove()
    dismissButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  })
  expect(document.activeElement).toBe(nearest)
})
