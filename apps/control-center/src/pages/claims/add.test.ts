// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { AddAccountPage } from './add'

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

/** Renders Add Account, reached from `returnTo` when given, and removes it when the test ends. */
async function renderAddAccount(returnTo?: string): Promise<HTMLDivElement> {
  const dom = browser.acquire()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    dom.window.close()
  })
  const entry = { pathname: '/accounts/add', state: returnTo === undefined ? null : { returnTo } }
  await act(async () => {
    root.render(
      createElement(
        TestChakraProvider,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: [entry] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/accounts/add', element: createElement(AddAccountPage) }),
            createElement(Route, { path: '/accounts', element: createElement('p', null, 'Accounts page') }),
            createElement(Route, { path: '/home', element: createElement('p', null, 'Home page') }),
          ),
        ),
      ),
    )
  })
  return container
}

async function clickBack(container: HTMLElement): Promise<void> {
  const back = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Back')
  assert.exists(back, 'Expected a Back button')
  await act(async () => {
    back.click()
  })
}

describe('Add Account', () => {
  it('goes back to the page that offered it', async () => {
    const container = await renderAddAccount('/home')
    await clickBack(container)
    expect(container.textContent).toBe('Home page')
  })

  it('goes back to Accounts when no page is named', async () => {
    const container = await renderAddAccount()
    await clickBack(container)
    expect(container.textContent).toBe('Accounts page')
  })

  it('closes on Escape', async () => {
    const container = await renderAddAccount('/home')
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.textContent).toBe('Home page')
  })

  it('marks its content as the main landmark, since it renders without the app layout', async () => {
    const container = await renderAddAccount()
    expect(container.querySelector('main')?.textContent).toContain('Connect New Account')
  })
})
