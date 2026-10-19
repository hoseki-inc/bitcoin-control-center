// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { MotionGlobalConfig } from 'framer-motion'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { type Mock, assert, expect, it, onTestFinished, vi } from 'vitest'
import { OnboardingTakeover } from './onboarding-takeover'

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

/** Render the introduction open; it portals into the body, so read from there. */
async function renderTakeover(desktop = false): Promise<{ onSkip: Mock<() => void>; onAddAccount: Mock<() => void> }> {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Steps turn over at once, so each check sees only the step on screen.
  MotionGlobalConfig.skipAnimations = true
  // The previews draw the app's charts, which watch their size and the reduced-motion setting.
  const matchMedia = (media: string): MediaQueryList => ({
    media,
    matches: true,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })
  dom.window.matchMedia = matchMedia
  vi.stubGlobal('matchMedia', matchMedia)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe = vi.fn()
      public disconnect = vi.fn()
    },
  )
  const onSkip = vi.fn<() => void>()
  const onAddAccount = vi.fn<() => void>()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  // Vitest owns teardown so it runs once, even after a failed assertion.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    MotionGlobalConfig.skipAnimations = false
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          MemoryRouter,
          null,
          createElement(OnboardingTakeover, { isOpen: true, onSkip, onAddAccount, desktop }),
        ),
      ),
    )
  })
  return { onSkip, onAddAccount }
}

/** The dialog's own buttons, not the ones drawn in the hidden app preview. */
function buttonNames(): string[] {
  return Array.from(document.body.querySelectorAll('[role="dialog"] button'))
    .filter((item) => item.closest('[aria-hidden="true"]') === null)
    .map((item) => item.textContent)
}

async function click(name: string): Promise<void> {
  const found = Array.from(document.body.querySelectorAll('button')).find((item) => item.textContent === name)
  assert(found !== undefined, `Expected a ${name} button`)
  await act(async () => {
    found.click()
  })
}

/** The title of the step on screen, not one on its way out. */
function heading(): string {
  const titles = Array.from(document.body.querySelectorAll('[role="dialog"] h2'))
  return titles.find((title) => title.closest('[aria-hidden="true"]') === null)?.textContent ?? ''
}

/** Elements a keyboard could reach inside parts of the dialog hidden from assistive technology. */
function tabbableWhileHidden(): Element[] {
  const hidden = '[role="dialog"] [aria-hidden="true"]'
  const selector = ['a[href]', 'button', 'input', 'select', 'textarea', '[tabindex]']
    .map((target) => `${hidden} ${target}`)
    .join(', ')
  return Array.from(document.body.querySelectorAll(selector)).filter(
    (item) => item.getAttribute('tabindex') !== '-1' && item.closest('[inert]') === null,
  )
}

it('walks forward and back through the steps', async () => {
  await renderTakeover()
  expect(heading()).toBe('Your Bitcoin, in one place')
  expect(buttonNames()).not.toContain('Back')
  await click('Continue')
  expect(heading()).toBe('Bring in what you already use')
  expect(document.body.textContent).toContain('Step 2 of 5')
  await click('Back')
  expect(heading()).toBe('Your Bitcoin, in one place')
})

it('ends on Add Account and Not Now instead of Continue and Skip', async () => {
  const { onSkip, onAddAccount } = await renderTakeover()
  for (let step = 1; step < 5; step++) {
    await click('Continue')
  }
  expect(heading()).toBe('Start with one account')
  expect(buttonNames()).toEqual(['Back', 'Not Now', 'Add Account'])
  await click('Add Account')
  expect(onAddAccount).toHaveBeenCalledTimes(1)
  await click('Not Now')
  expect(onSkip).toHaveBeenCalledTimes(1)
})

it('closes from Skip on any step', async () => {
  const { onSkip, onAddAccount } = await renderTakeover()
  await click('Continue')
  await click('Skip')
  expect(onSkip).toHaveBeenCalledTimes(1)
  expect(onAddAccount).not.toHaveBeenCalled()
})

it('closes from Escape', async () => {
  const { onSkip } = await renderTakeover()
  const dialog = document.body.querySelector('[role="dialog"]')
  assert(dialog !== null, 'Expected the introduction dialog')
  await act(async () => {
    dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(onSkip).toHaveBeenCalledTimes(1)
})

it.each([
  [true, 'saved on this computer'],
  [false, 'saved on your server'],
])('describes where data lives for desktop %s', async (desktop, body) => {
  await renderTakeover(desktop)
  for (let step = 1; step < 4; step++) {
    await click('Continue')
  }
  expect(heading()).toBe('Your data stays with you')
  expect(document.body.textContent).toContain(body)
  expect(document.body.textContent).toContain('Statement data')
})

it('keeps every preview out of the tab order', async () => {
  await renderTakeover()
  for (let step = 1; step <= 5; step++) {
    expect(tabbableWhileHidden(), `step ${step}`).toEqual([])
    if (step < 5) {
      await click('Continue')
    }
  }
})
