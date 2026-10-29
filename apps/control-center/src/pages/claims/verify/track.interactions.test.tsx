import { Wallets } from '@hoseki/packages/testing'
// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient, notFound } from '../../../testing/trpc'
import type { ClaimDto } from '../../../trpc/server-types'
import { ClaimsVerifyTrackPage } from './track'

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

/**
 * Render the track page; `existing` is the account Sentinel already has for the entered wallet, if any, and
 * `failCreate` makes saving a new wallet fail.
 */
async function renderTrackPage({
  existing,
  failCreate = false,
}: { existing?: { id: string; status: ClaimDto['status']; isArchived?: boolean }; failCreate?: boolean } = {}) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  const requests: Operation[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation)
    switch (operation.path) {
      case 'portalProve.registry.claims.get.byAccount':
        if (existing === undefined) {
          throw notFound('Claim not found')
        }
        return { id: existing.id, status: existing.status, isArchived: existing.isArchived ?? false }
      case 'portalProve.registry.claims.track':
        return { id: existing?.id, status: 'unverified' }
      case 'portalProve.registry.claims.create.singlesig':
      case 'portalProve.registry.claims.create.multisig':
        if (failCreate) {
          throw new Error('Sentinel is not reachable')
        }
        return { claim: { id: 'acct_new' }, keystores: [] }
      default:
        return null
    }
  })
  const client = new QueryClient({ logger: { log: console.log, warn: console.warn, error: () => undefined } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    client.clear()
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <ChakraProvider>
          <MemoryRouter initialEntries={['/accounts/verify/track']}>
            <Routes>
              <Route path="/accounts/verify/track" element={<ClaimsVerifyTrackPage />} />
              <Route path="/accounts/:id" element={<p>Account page</p>} />
              <Route path="/accounts" element={<p>Accounts list</p>} />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>
      </TestTrpcProvider>,
    )
  })

  const fill = async (element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
    await act(async () => {
      // Set the value the way the browser does, so React sees the change.
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
      assert(descriptor?.set !== undefined, 'Expected the value setter')
      descriptor.set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const nameInput = container.querySelector('input')
  const walletInput = container.querySelector('textarea')
  assert.exists(nameInput, 'Expected the display name input')
  assert.exists(walletInput, 'Expected the wallet input')
  const pickedScriptType = (): string | undefined =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[name="script-type"]')).find((radio) => radio.checked)
      ?.value
  const pick = async (label: string): Promise<void> => {
    const radio = container.querySelector<HTMLInputElement>(`input[name="script-type"][value="${label}"]`)
    assert.exists(radio, `Expected the ${label} option`)
    await act(async () => {
      radio.click()
    })
  }
  const trackButton = (): HTMLButtonElement => {
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Track Wallet')
    assert(button !== undefined, 'Expected the Track Wallet button')
    return button
  }
  const press = async (): Promise<void> => {
    await act(async () => {
      trackButton().click()
    })
  }
  const submit = async (opens = 'Account page'): Promise<void> => {
    await press()
    await vi.waitFor(() => {
      expect(container.textContent).toContain(opens)
    })
  }
  const created = (): Operation[] => requests.filter((request) => request.path.includes('.create.'))
  const tracked = (): Operation[] => requests.filter((request) => request.path.endsWith('.claims.track'))
  return {
    fillName: async (value: string) => fill(nameInput, value),
    fillWallet: async (value: string) => fill(walletInput, value),
    pickedScriptType,
    pick,
    press,
    submit,
    text: () => container.textContent,
    isTrackEnabled: () => !trackButton().disabled,
    created,
    tracked,
  }
}

it('keeps the picked script type when the xpub is edited, and saves that type', async () => {
  const page = await renderTrackPage()
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.nativeSegwitXpub.toString())
  await page.pick('Native SegWit (P2WPKH)')

  await page.fillWallet(`${Wallets.nativeSegwitXpub.toString()}\n`)

  expect(page.pickedScriptType()).toBe('Native SegWit (P2WPKH)')
  await page.submit()
  expect(page.created()).toMatchObject([
    {
      path: 'portalProve.registry.claims.create.singlesig',
      input: {
        account: Wallets.singlesigNativeSegwitAccount.descriptor(),
        displayName: 'Cold storage',
        trackOnly: true,
      },
    },
  ])
})

it('saves a multisig descriptor as track-only', async () => {
  const page = await renderTrackPage()
  await page.fillName('Family vault')
  await page.fillWallet(Wallets.multisigNativeSegwitAccount.toString())

  await page.submit()

  expect(page.created()).toMatchObject([
    {
      path: 'portalProve.registry.claims.create.multisig',
      input: {
        account: Wallets.multisigNativeSegwitAccount.descriptor(),
        displayName: 'Family vault',
        trackOnly: true,
      },
    },
  ])
})

it('opens a wallet that is already in Control Center without adding it again', async () => {
  const page = await renderTrackPage({ existing: { id: 'acct_existing', status: 'unverified' } })
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())

  await page.submit()

  expect(page.created()).toEqual([])
  expect(page.tracked()).toEqual([])
})

it('tracks a wallet someone started proving instead of leaving it pending', async () => {
  const page = await renderTrackPage({ existing: { id: 'acct_pending', status: 'pending' } })
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())

  await page.submit()

  expect(page.created()).toEqual([])
  expect(page.tracked()).toMatchObject([{ input: { id: 'acct_pending' } }])
})

it('describes the wallet it read, or says what it accepts', async () => {
  const page = await renderTrackPage()

  await page.fillWallet(Wallets.multisigNativeSegwitAccount.toString())
  expect(page.text()).toContain('Multisig, 2 of 3')
  expect(page.pickedScriptType()).toBeUndefined()

  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())
  expect(page.text()).toContain('Single-sig, Native SegWit (P2WPKH)')

  await page.fillWallet('not a wallet')
  expect(page.text()).toContain('Enter an xpub, or a single-sig or multisig descriptor')
  expect(page.isTrackEnabled()).toBe(false)
})

it('waits for a name before it can track a wallet', async () => {
  const page = await renderTrackPage()
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())
  expect(page.isTrackEnabled()).toBe(false)

  await page.fillName('  ')
  expect(page.isTrackEnabled()).toBe(false)

  await page.fillName('Cold storage')
  expect(page.isTrackEnabled()).toBe(true)
})

it('opens the archived list for an archived wallet, without tracking it', async () => {
  const page = await renderTrackPage({ existing: { id: 'acct_archived', status: 'pending', isArchived: true } })
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())

  await page.submit('Accounts list')

  expect(page.tracked()).toEqual([])
  expect(page.created()).toEqual([])
})

it('stays on the page, ready to try again, when the wallet cannot be saved', async () => {
  const page = await renderTrackPage({ failCreate: true })
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())

  await page.press()

  await vi.waitFor(() => {
    expect(page.created()).toHaveLength(1)
    expect(page.isTrackEnabled()).toBe(true)
  })
  expect(page.text()).not.toContain('Account page')
})
