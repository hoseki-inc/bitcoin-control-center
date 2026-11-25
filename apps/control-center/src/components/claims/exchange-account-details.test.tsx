// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { MotionGlobalConfig } from 'framer-motion'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { ExchangeAccountDetails, type ExchangeAccountDetailsProps } from './exchange-account-details'

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

async function mountDetails(props: ExchangeAccountDetailsProps) {
  const dom = browser.acquire()
  MotionGlobalConfig.skipAnimations = true
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    MotionGlobalConfig.skipAnimations = false
    dom.window.close()
  })

  await act(async () => {
    root.render(
      <ChakraProvider>
        <MemoryRouter>
          <ExchangeAccountDetails {...props} />
        </MemoryRouter>
      </ChakraProvider>,
    )
  })

  const dialog = (): Element | null => document.body.querySelector('[role="dialog"]')

  const clickDialogButton = async (label: string): Promise<void> => {
    const activeDialog = dialog()
    assert(activeDialog !== null, 'Expected confirmation dialog to be open')
    const button = [...activeDialog.querySelectorAll('button')].find((node) => node.textContent.trim() === label)
    assert(button, `Dialog button not found: ${label}`)
    await act(async () => {
      button.click()
    })
  }

  return {
    container,
    dialog,
    clickDialogButton,
    text: () => container.textContent,
    clickButton: async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === label)
      assert(button, `Button not found: ${label}`)
      await act(async () => {
        button.click()
      })
    },
  }
}

it('renders the expired Option D1 layout with Expired status, tooltip trigger, and Reconnect Account button', async () => {
  const onReconnect = vi.fn<() => void>()
  const onRefresh = vi.fn<() => void>()
  const onDelete = vi.fn<() => void>()

  const view = await mountDetails({
    exchangeName: 'Coinbase',
    logoSrc: '/images/exchanges/coinbase.svg',
    displayName: 'Personal BTC Wallet',
    balance: null,
    createdAt: '2026-11-22T12:00:00.000Z',
    needsReconnect: true,
    isRefreshing: false,
    isDeleting: false,
    onReconnect,
    onRefresh,
    onDelete,
  })

  expect(view.text()).toContain('Personal BTC Wallet')
  expect(view.text()).toContain('Coinbase connection expired')
  expect(view.text()).toContain('Expired')
  expect(view.text()).not.toContain('Reconnect Required')
  expect(view.text()).toContain('—')
  expect(view.text()).not.toContain('Refresh Balance')

  const tooltipButton = view.container.querySelector(
    'button[aria-label="Reconnect your account to view your balance."]',
  )
  expect(tooltipButton).not.toBeNull()

  await view.clickButton('Reconnect Account')
  expect(onReconnect).toHaveBeenCalledTimes(1)

  await view.clickButton('Remove Account')
  expect(onDelete).not.toHaveBeenCalled()
  expect(view.dialog()?.textContent).toContain('Remove Personal BTC Wallet?')
  expect(view.dialog()?.textContent).toContain('Coinbase account')

  await view.clickDialogButton('Cancel')
  expect(onDelete).not.toHaveBeenCalled()
  await vi.waitFor(() => {
    expect(view.dialog()).toBeNull()
  })

  await view.clickButton('Remove Account')
  await view.clickDialogButton('Remove')
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('renders the connected layout with balance, Connected status, and Refresh Balance button', async () => {
  const onReconnect = vi.fn<() => void>()
  const onRefresh = vi.fn<() => void>()
  const onDelete = vi.fn<() => void>()

  const view = await mountDetails({
    exchangeName: 'Kraken',
    logoSrc: '/images/exchanges/kraken.svg',
    displayName: 'Kraken Savings',
    balance: '125000000',
    createdAt: '2026-11-22T12:00:00.000Z',
    needsReconnect: false,
    isRefreshing: false,
    isDeleting: false,
    onReconnect,
    onRefresh,
    onDelete,
  })

  expect(view.text()).toContain('Kraken Savings')
  expect(view.text()).toContain('1.25000000 BTC')
  expect(view.text()).toContain('Connected')
  expect(view.text()).not.toContain('Kraken connection expired')
  expect(view.text()).not.toContain('Reconnect Account')

  const tooltipButton = view.container.querySelector(
    'button[aria-label="Reconnect your account to view your balance."]',
  )
  expect(tooltipButton).toBeNull()

  await view.clickButton('Refresh Balance')
  expect(onRefresh).toHaveBeenCalledTimes(1)
})

it('renders the expired Option D1 layout for Strike with children preserved below', async () => {
  const onReconnect = vi.fn<() => void>()
  const onDelete = vi.fn<() => void>()

  const view = await mountDetails({
    exchangeName: 'Strike',
    logoSrc: '/images/exchanges/strike-icon.svg',
    displayName: 'My Strike Account',
    balance: null,
    createdAt: '2026-11-22T12:00:00.000Z',
    needsReconnect: true,
    isRefreshing: false,
    isDeleting: false,
    onReconnect,
    onRefresh: vi.fn<() => void>(),
    onDelete,
    children: <div>Account Statements</div>,
  })

  expect(view.text()).toContain('My Strike Account')
  expect(view.text()).toContain('Strike connection expired')
  expect(view.text()).toContain('Expired')
  expect(view.text()).toContain('Account Statements')
  expect(view.text()).not.toContain('Refresh Balance')

  await view.clickButton('Reconnect Account')
  expect(onReconnect).toHaveBeenCalledTimes(1)

  await view.clickButton('Remove Account')
  expect(onDelete).not.toHaveBeenCalled()
  expect(view.dialog()?.textContent).toContain('Remove My Strike Account?')
  expect(view.dialog()?.textContent).toContain('imported statements')

  await view.clickDialogButton('Cancel')
  expect(onDelete).not.toHaveBeenCalled()
})
