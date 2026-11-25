// @vitest-environment node
import { parseUnknown } from '@hoseki/packages/result'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { useHandedOffAccountScan } from '../../../pages/claims/verify/use-xpub-script-balances'
import {
  type ScanChunkInput,
  type ScanChunkResult,
  resetXpubScanStore,
} from '../../../pages/claims/verify/xpub-scan-store'
import { TestTrpcProvider, createTestTrpcClient, notFound } from '../../../testing/trpc'
import { ConnectManual } from './connect-manual'

const bip32Vector1Xpub =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'

const scanChunkInputSchema = z.object({
  account: z.string(),
  chain: z.enum(['receive', 'change']),
  startIndex: z.number(),
  count: z.number(),
})

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

type ScanChunkHandler = (input: ScanChunkInput) => Promise<ScanChunkResult> | ScanChunkResult

function SigningRouteProbe({
  accountKey,
  claimReadyPromise,
}: {
  accountKey: string
  claimReadyPromise: Promise<void>
}): JSX.Element {
  const [claimReady, setClaimReady] = useState(false)

  useEffect(() => {
    let active = true
    void claimReadyPromise.then(() => {
      if (active) {
        setClaimReady(true)
      }
    })
    return () => {
      active = false
    }
  }, [claimReadyPromise])

  if (!claimReady) {
    return <div data-testid="signing-probe">loading-claim</div>
  }
  return <SigningAccountProbe accountKey={accountKey} />
}

function SigningAccountProbe({ accountKey }: { accountKey: string }): JSX.Element {
  const handedOff = useHandedOffAccountScan(accountKey)
  return (
    <div data-testid="signing-probe">
      {handedOff === undefined
        ? 'fallback'
        : handedOff.status === 'error'
          ? 'error'
          : `${handedOff.status}:${(handedOff.balanceSats ?? 0n).toString()}`}
    </div>
  )
}

async function renderConnectManual({
  scanChunk,
  handedOffAccountKey = '',
}: {
  scanChunk: ScanChunkHandler
  handedOffAccountKey?: string
}) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  let resolveClaimReady: (() => void) | undefined
  const claimReadyPromise = new Promise<void>((resolve) => {
    resolveClaimReady = resolve
  })
  const rpc = createTestTrpcClient(async (operation) => {
    switch (operation.path) {
      case 'portalProve.onchain.scanAccountChunk': {
        const parsed = parseUnknown(scanChunkInputSchema, operation.input).expect('valid scanAccountChunk input')
        return scanChunk(parsed)
      }
      case 'portalProve.accounts.get.byAccount':
        throw notFound('Claim not found')
      case 'portalProve.accounts.create.singlesig':
        return { claim: { id: 'acct_new' }, keystores: [] }
      default:
        return null
    }
  })
  const client = new QueryClient({
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    resetXpubScanStore()
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
          <MemoryRouter initialEntries={['/accounts/connect/manual']}>
            <Routes>
              <Route path="/accounts/connect/manual" element={<ConnectManual />} />
              <Route
                path="/accounts/:id/signing"
                element={<SigningRouteProbe accountKey={handedOffAccountKey} claimReadyPromise={claimReadyPromise} />}
              />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>
      </TestTrpcProvider>,
    )
  })

  const fill = async (element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
      assert(descriptor?.set !== undefined, 'Expected value setter')
      descriptor.set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const getDisplayNameInput = (): HTMLInputElement => {
    const el = container.querySelector('#display-name')
    assert(el instanceof dom.window.HTMLInputElement, 'Expected display name input')
    return el
  }

  const getSourceTextarea = (): HTMLTextAreaElement => {
    const el = container.querySelector('#bitcoin-source')
    assert(el instanceof dom.window.HTMLTextAreaElement, 'Expected bitcoin source textarea')
    return el
  }

  const getSubmitButton = (): HTMLButtonElement => {
    const el = container.querySelector('button[type="submit"]')
    assert(el instanceof dom.window.HTMLButtonElement, 'Expected submit button')
    return el
  }

  const getCheckedRadioValue = (): string | null => {
    const checked = container.querySelector('input[type="radio"]:checked')
    return checked instanceof dom.window.HTMLInputElement ? checked.value : null
  }

  const pickScriptType = async (value: string): Promise<void> => {
    const radio = container.querySelector(`input[type="radio"][value="${value}"]`)
    assert(radio instanceof dom.window.HTMLInputElement, `Expected radio for ${value}`)
    await act(async () => {
      radio.click()
    })
  }

  return {
    container,
    client,
    fillName: async (value: string) => fill(getDisplayNameInput(), value),
    fillSource: async (value: string) => fill(getSourceTextarea(), value),
    isSubmitEnabled: () => !getSubmitButton().disabled,
    submit: async () => {
      await act(async () => {
        getSubmitButton().click()
      })
    },
    checkedScriptType: getCheckedRadioValue,
    pickScriptType,
    finishClaimLoad: async () => {
      await act(async () => {
        resolveClaimReady?.()
        await Promise.resolve()
      })
    },
    text: () => container.textContent,
  }
}

it('does not lock in a stale auto-selection when clearing and re-pasting the same xpub after TTL expiry', async () => {
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })

  let phase: 'first' | 'second' = 'first'
  const secondPhaseResolvers: Array<(result: ScanChunkResult) => void> = []

  const page = await renderConnectManual({
    scanChunk: async (input) => {
      if (phase === 'first') {
        if (input.account.includes(':wpkh(') && input.chain === 'receive' && input.startIndex === 0) {
          return { usedIndexes: [0], balanceSats: '100000000' }
        }
        return { usedIndexes: [], balanceSats: '0' }
      }
      return new Promise<ScanChunkResult>((resolve) => {
        secondPhaseResolvers.push(resolve)
      })
    },
  })

  await page.fillName('Cold storage')
  await page.fillSource(bip32Vector1Xpub)
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
  expect(page.checkedScriptType()).toBe('Native SegWit (P2WPKH)')
  expect(page.isSubmitEnabled()).toBe(true)

  await page.fillSource('')
  expect(page.isSubmitEnabled()).toBe(false)

  await vi.advanceTimersByTimeAsync(60_000)
  page.client.clear()
  phase = 'second'

  await page.fillSource(bip32Vector1Xpub)
  expect(page.checkedScriptType()).toBeNull()
  expect(page.isSubmitEnabled()).toBe(false)

  while (secondPhaseResolvers.length > 0) {
    const batch = secondPhaseResolvers.splice(0)
    await act(async () => {
      for (const resolve of batch) {
        resolve({ usedIndexes: [], balanceSats: '0' })
      }
      await Promise.resolve()
    })
  }

  expect(page.checkedScriptType()).toBeNull()
  expect(page.isSubmitEnabled()).toBe(false)
})

it('hands off an in-flight scan on submit so the signing route receives progress and finishes without restarting', async () => {
  const expectedAccountKey = `bitcoin_mainnet::wpkh(${bip32Vector1Xpub}/<0;1>/*)#3zpr76xn`
  let resolveSecondWave: ((result: ScanChunkResult) => void) | undefined

  const page = await renderConnectManual({
    handedOffAccountKey: expectedAccountKey,
    scanChunk: async (input) => {
      if (input.account.includes(':wpkh(') && input.chain === 'receive' && input.startIndex === 0) {
        return { usedIndexes: [0], balanceSats: '25000000' }
      }
      if (input.account.includes(':wpkh(') && input.chain === 'receive' && input.startIndex === 10) {
        return new Promise<ScanChunkResult>((resolve) => {
          resolveSecondWave = resolve
        })
      }
      if (input.account.includes(':wpkh(') && input.chain === 'change' && input.startIndex === 0) {
        return { usedIndexes: [0], balanceSats: '50000000' }
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
  })

  await page.fillName('Cold storage')
  await page.fillSource(bip32Vector1Xpub)

  await vi.waitFor(() => {
    expect(resolveSecondWave).toBeDefined()
    expect(page.text()).toContain('0.25000000 BTC')
  })

  await page.pickScriptType('Native SegWit (P2WPKH)')
  expect(page.isSubmitEnabled()).toBe(true)

  await page.submit()

  await vi.waitFor(() => {
    expect(page.container.querySelector('[data-testid="signing-probe"]')?.textContent).toBe('loading-claim')
  })

  await page.finishClaimLoad()

  await vi.waitFor(() => {
    expect(page.container.querySelector('[data-testid="signing-probe"]')?.textContent).toBe('loading:25000000')
  })

  await act(async () => {
    resolveSecondWave?.({ usedIndexes: [12], balanceSats: '25000000' })
  })

  await vi.waitFor(() => {
    expect(page.container.querySelector('[data-testid="signing-probe"]')?.textContent).toBe('loaded:100000000')
  })
})
