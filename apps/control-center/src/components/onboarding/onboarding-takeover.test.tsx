import { Err, Ok, type Result } from '@hoseki/packages/result'
// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { MotionGlobalConfig } from 'framer-motion'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { type Mock, assert, expect, it, onTestFinished, vi } from 'vitest'
import type { ConnectionDetails } from '../../pages/settings/electrum-connection'
import type { ElectrumChoice } from './electrum-choice'
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
async function renderTakeover(
  desktop = false,
  serverChoice?: ElectrumChoice,
): Promise<{ onSkip: Mock<() => void>; onAddAccount: Mock<() => void> }> {
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
  // The node form scrolls a problem into view; this DOM doesn't lay anything out to scroll.
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn<() => void>()
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
          createElement(OnboardingTakeover, { isOpen: true, onSkip, onAddAccount, desktop, serverChoice }),
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

interface FakeServerChoice extends ElectrumChoice {
  keepPublic: Mock<ElectrumChoice['keepPublic']>
  connectNode: Mock<(details: ConnectionDetails) => Promise<Result<void, Error>>>
  startTor: Mock<ElectrumChoice['startTor']>
}

/** A server choice that succeeds unless told otherwise. */
function fakeServerChoice(
  connected: Result<void, Error> = Ok(undefined),
  kept: Result<void, Error> = Ok(undefined),
): FakeServerChoice {
  return {
    keepPublic: vi.fn<ElectrumChoice['keepPublic']>(async () => kept),
    connectNode: vi.fn(async () => connected),
    startTor: vi.fn<ElectrumChoice['startTor']>(),
  }
}

async function choose(value: 'own' | 'public'): Promise<void> {
  const radio = document.body.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)
  assert(radio !== null, `Expected the ${value} choice`)
  await act(async () => {
    radio.click()
  })
}

async function toggle(id: string): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>(`#${id}`)
  assert(input !== null, `Expected the ${id} switch`)
  await act(async () => {
    input.click()
  })
}

async function type(id: string, value: string): Promise<void> {
  const field = document.body.querySelector<HTMLInputElement>(`#${id}`)
  assert(field !== null, `Expected the ${id} field`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(field, value)
    field.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

/** Through the four steps every install has, to desktop's server step. */
async function toServerStep(): Promise<void> {
  for (let step = 1; step < 5; step++) {
    await click('Continue')
  }
  expect(heading()).toBe('Choose your Electrum server')
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

it('focuses the dialog itself on open, not one of its buttons', async () => {
  await renderTakeover()
  await vi.waitFor(() => {
    expect(document.activeElement?.getAttribute('role')).toBe('dialog')
  })
})

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

it('asks desktop for an Electrum server just before the first account', async () => {
  const serverChoice = fakeServerChoice()
  await renderTakeover(true, serverChoice)
  await toServerStep()
  expect(document.body.textContent).toContain('Step 5 of 6')
  // The public server starts chosen.
  expect(document.body.querySelector<HTMLInputElement>('input[value="public"]')?.checked).toBe(true)
  // The step's text and preview say what Blockstream sees; only your node gets a line under the choices.
  expect(document.body.querySelector('#server-consequence')).toBeNull()
  await choose('own')
  expect(document.body.textContent).toContain('Only your node sees your wallets.')
  await choose('public')
  await click('Continue')
  expect(serverChoice.keepPublic).toHaveBeenCalledExactlyOnceWith(false)
  expect(heading()).toBe('Start with one account')
  expect(document.body.textContent).toContain('Step 6 of 6')
})

it('offers Tor for the public server, and leaves your node’s Tor to its own step', async () => {
  const serverChoice = fakeServerChoice()
  await renderTakeover(true, serverChoice)
  await toServerStep()
  expect(document.body.querySelector('#public-tor')).not.toBeNull()
  expect(document.body.textContent).toContain('Your IP address203.0.113.24')
  await toggle('public-tor')
  // Tor starts while you read, so connecting waits less.
  expect(serverChoice.startTor).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain('Your IP addressHidden by Tor')
  await choose('own')
  expect(document.body.querySelector('#public-tor')).toBeNull()
  await choose('public')
  // The switch remembers Tor across choices.
  expect(document.body.querySelector<HTMLInputElement>('#public-tor')?.checked).toBe(true)
  await click('Continue')
  expect(serverChoice.keepPublic).toHaveBeenCalledExactlyOnceWith(true)
  expect(heading()).toBe('Start with one account')
})

it('stays on the server step when Tor does not connect', async () => {
  const serverChoice = fakeServerChoice(Ok(undefined), Err(new Error('Tor could not connect within two minutes.')))
  await renderTakeover(true, serverChoice)
  await toServerStep()
  await toggle('public-tor')
  await click('Continue')
  expect(heading()).toBe('Choose your Electrum server')
  const alert = document.body.querySelector('[role="alert"]')?.textContent
  expect(alert).toContain('Couldn’t connect through Tor. Try again, or turn off Connect via Tor.')
  // Only Sentinel's own errors are shown as they are.
  expect(alert).toContain('Tor didn’t answer.')
  // Turning Tor off clears the problem, and keeps the public server as it is.
  serverChoice.keepPublic.mockResolvedValue(Ok(undefined))
  await toggle('public-tor')
  expect(document.body.querySelector('[role="alert"]')).toBeNull()
  await click('Continue')
  expect(serverChoice.keepPublic).toHaveBeenLastCalledWith(false)
  expect(heading()).toBe('Start with one account')
})

it('leaves the server step out without a server choice to make', async () => {
  await renderTakeover(true)
  for (let step = 1; step < 5; step++) {
    await click('Continue')
  }
  expect(heading()).toBe('Start with one account')
})

it('connects your own node before going on', async () => {
  const serverChoice = fakeServerChoice()
  await renderTakeover(true, serverChoice)
  await toServerStep()
  await choose('own')
  await click('Continue')
  expect(heading()).toBe('Connect your node')
  // A follow-up to the server step, not a step of its own.
  expect(document.body.textContent).toContain('Step 5 of 6')
  await click('Connect')
  expect(document.body.textContent).toContain('Enter your node’s address.')
  await type('node-host', ' umbrel.local ')
  await click('Connect')
  await vi.waitFor(() => {
    expect(heading()).toBe('Start with one account')
  })
  expect(serverChoice.connectNode).toHaveBeenCalledWith({
    host: 'umbrel.local',
    port: 50002,
    protocol: 'ssl',
    torEnabled: false,
  })
  expect(serverChoice.keepPublic).not.toHaveBeenCalled()
  // Coming back to the connected node goes on without connecting again.
  await click('Back')
  expect(document.body.textContent).toContain('Connected to your node.')
  await click('Continue')
  expect(heading()).toBe('Start with one account')
  expect(serverChoice.connectNode).toHaveBeenCalledTimes(1)
})

it('stays on the form when your node does not connect', async () => {
  const serverChoice = fakeServerChoice(Err(new Error('Connection refused')))
  await renderTakeover(true, serverChoice)
  await toServerStep()
  await choose('own')
  await click('Continue')
  await type('node-host', 'umbrel.local')
  await click('Connect')
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain('Couldn’t connect to umbrel.local:50002.')
  })
  expect(heading()).toBe('Connect your node')
})

it('asks for Tor before connecting to an onion address', async () => {
  const serverChoice = fakeServerChoice()
  await renderTakeover(true, serverChoice)
  await toServerStep()
  await choose('own')
  await click('Continue')
  await type('node-host', 'abcdefghijklmnop.onion')
  await click('Connect')
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Onion addresses need Tor.')
  expect(serverChoice.connectNode).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Your IP address203.0.113.24')
  await toggle('node-tor')
  expect(serverChoice.startTor).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain('Your IP addressHidden by Tor')
  await click('Connect')
  await vi.waitFor(() => {
    expect(heading()).toBe('Start with one account')
  })
  expect(serverChoice.connectNode).toHaveBeenCalledWith(expect.objectContaining({ torEnabled: true }))
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
