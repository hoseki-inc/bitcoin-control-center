// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { browserLogger } from '../../logger'
import { RenderErrorBoundary } from './render-error-boundary'

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

let root: Root
let shouldThrow = true

function Broken(): JSX.Element {
  if (shouldThrow) {
    throw new Error('Broken page')
  }
  return <p>Home page</p>
}

async function render(initialPath: string): Promise<void> {
  const dom = browser.acquire()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    } finally {
      vi.restoreAllMocks()
      dom.window.close()
    }
  })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await act(async () => {
    root.render(
      <ChakraProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Link to="/settings">Settings</Link>
          <Link to="/home">Home</Link>
          <RenderErrorBoundary>
            <Routes>
              <Route path="home" Component={Broken} />
              <Route path="settings" element={<p>Settings page</p>} />
            </Routes>
          </RenderErrorBoundary>
        </MemoryRouter>
      </ChakraProvider>,
    )
  })
}

async function click(text: string): Promise<void> {
  const target = Array.from(document.querySelectorAll('a, button')).find((element) => element.textContent === text)
  assert(target instanceof HTMLElement, `Missing ${text}`)
  await act(async () => {
    target.click()
  })
}

it('shows a way back and logs the error when a page throws', async () => {
  shouldThrow = true
  const logError = vi.spyOn(browserLogger, 'error').mockImplementation(() => undefined)
  await render('/home')

  expect(document.body.textContent).toContain('Something went wrong')
  expect(document.body.textContent).toContain('Back to Home')
  expect(document.body.textContent).toContain('Reload')
  expect(logError.mock.calls.at(-1)).toMatchObject([{ err: { message: 'Broken page' } }, 'Render error'])
})

it('logs once when navigating from a working page to a broken one', async () => {
  shouldThrow = true
  const logError = vi.spyOn(browserLogger, 'error').mockImplementation(() => undefined)
  await render('/settings')

  await click('Home')
  expect(document.body.textContent).toContain('Something went wrong')
  expect(logError).toHaveBeenCalledTimes(1)
})

it('clears the error after navigating to another page', async () => {
  shouldThrow = true
  vi.spyOn(browserLogger, 'error').mockImplementation(() => undefined)
  await render('/home')

  await click('Settings')
  expect(document.body.textContent).toContain('Settings page')
  expect(document.body.textContent).not.toContain('Something went wrong')
})

it('clears the error from Back to Home when Home was the page that failed', async () => {
  shouldThrow = true
  vi.spyOn(browserLogger, 'error').mockImplementation(() => undefined)
  await render('/home')

  shouldThrow = false
  await click('Back to Home')
  expect(document.body.textContent).toContain('Home page')
  expect(document.body.textContent).not.toContain('Something went wrong')
})
