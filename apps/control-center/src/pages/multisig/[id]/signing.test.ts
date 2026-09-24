// @vitest-environment node
import { Box } from '@chakra-ui/react'
import { Address, DerivationPath, MultiSigAccount } from '@hoseki/packages/bitcoin'
import { Err, Ok } from '@hoseki/packages/result'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import type { PartialModuleMock } from '@hoseki/packages/testing/partial-module-mock'
import { TrezorInfo } from '@hoseki/packages/ui/wallet-ui/trezor/trezor-info'
import { HardwareDeviceError, Slip132 } from '@hoseki/packages/wallet'
import TransportWebHID from '@ledgerhq/hw-transport-webhid'
import {
  type InvalidateOptions,
  type InvalidateQueryFilters,
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { Fragment, type ReactElement, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import type * as ReactRouter from 'react-router'
import { RouterProvider, createMemoryRouter } from 'react-router'
import type * as Sonner from 'sonner'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LedgerSigning as SinglesigLedgerSigning } from '../../../components/claims/ledger/ledger-signing'
import type * as TrezorServiceSingletonModule from '../../../components/claims/trezor/trezor-service-singleton'
import { TrezorSigning as SinglesigTrezorSigning } from '../../../components/claims/trezor/trezor-signing'
import type * as MultisigPageWrapperModule from '../../../components/multisig/multisig-page-wrapper'
import { MultisigPageWrapper, getIndicatorKeystores } from '../../../components/multisig/multisig-page-wrapper'
import type * as BbqrScannerModule from '../../../components/qr/bbqr-scanner'
import type * as UseLedgerStoreModule from '../../../hooks/use-ledger-store'
import type * as UseUrlParametersModule from '../../../hooks/use-url-parameters'
import type { SigningFlowProps } from '../../../lib/claim-flow'
import type * as LoggerModule from '../../../logger'
import type { ClaimDto } from '../../../trpc/server-types'
import { MultisigSigningPage } from './signing'

const mocks = await vi.hoisted(async () => {
  // Add a DOM without replacing Node byte-array globals used by the Bitcoin SDK.
  const { JSDOM } = await import('jsdom')
  function createDom() {
    const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
    })
    const domGlobals = {
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLElement: window.HTMLElement,
      Element: window.Element,
      HTMLButtonElement: window.HTMLButtonElement,
      Node: window.Node,
      Event: window.Event,
      FileReader: window.FileReader,
      MouseEvent: window.MouseEvent,
      getComputedStyle: window.getComputedStyle.bind(window),
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    }

    return domGlobals
  }
  let currentDom = createDom()
  let acquired = false
  for (const [name, value] of Object.entries(currentDom)) {
    vi.stubGlobal(name, value)
  }
  function acquireDom() {
    if (acquired) {
      currentDom = createDom()
    }
    acquired = true
    return currentDom
  }

  let claim: ClaimDto | undefined
  return {
    acquireDom,
    get domGlobals() {
      return currentDom
    },
    get claim(): ClaimDto {
      if (!claim) {
        throw new Error('Signing test claim has not been initialized')
      }
      return claim
    },
    set claim(value: ClaimDto) {
      claim = value
    },
    walletType: 'ledger' as 'ledger' | 'trezor' | 'coldcard' | 'keystone',
    ledger: { isInitialized: false, init: vi.fn(), reset: vi.fn(), signMessage: vi.fn() },
    trezorSign: vi.fn(),
    navigate: vi.fn(),
    completeMessage: vi.fn(),
    completeChallenge: vi.fn(),
    fetchClaim: vi.fn(),
    invalidateClaim: vi.fn(),
    toastError: vi.fn(),
  }
})

vi.mock<PartialModuleMock<typeof UseLedgerStoreModule>>(import('../../../hooks/use-ledger-store'), () => ({
  useLedgerStore: (
    selector: (
      state: Pick<
        ReturnType<typeof UseLedgerStoreModule.useLedgerStore.getState>,
        'isInitialized' | 'init' | 'reset' | 'signMessage'
      >,
    ) => unknown,
  ) => selector(mocks.ledger),
  useToastOnLedgerDisconnect: () => undefined,
}))
vi.mock<PartialModuleMock<typeof MultisigPageWrapperModule>>(
  import('../../../components/multisig/multisig-page-wrapper'),
  async (importOriginal) => {
    const original = await importOriginal<typeof MultisigPageWrapperModule>()
    const { useOutletContext } = await import('react-router')
    return {
      ...original,
      useMultisigPageWrapperContext: () => useOutletContext<{ claim: ClaimDto } | null>() ?? { claim: mocks.claim },
    }
  },
)
vi.mock<PartialModuleMock<typeof UseUrlParametersModule>>(
  import('../../../hooks/use-url-parameters'),
  async (importOriginal) => ({
    ...(await importOriginal()),
    useUrlParameter: () => mocks.claim.id,
  }),
)
vi.mock<PartialModuleMock<typeof TrezorServiceSingletonModule>>(
  import('../../../components/claims/trezor/trezor-service-singleton'),
  () => ({
    trezorService: { signCustomMessage: mocks.trezorSign },
  }),
)
vi.mock<PartialModuleMock<typeof LoggerModule>>(import('../../../logger'), () => ({
  browserLogger: { error: vi.fn<() => void>() },
  captureHardwareWalletError: vi.fn<() => void>(),
}))
vi.mock(import('lottie-react'), () => ({ default: () => createElement(Fragment) }))
vi.mock<PartialModuleMock<typeof Sonner>>(import('sonner'), () => ({
  toast: Object.assign(vi.fn<typeof Sonner.toast>(), { error: mocks.toastError, success: vi.fn() }),
}))
vi.mock<PartialModuleMock<typeof ReactRouter>>(import('react-router'), async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useParams: () => ({ walletType: mocks.walletType, keystoreId: 're_ks_ledger' }),
  useNavigate: () => mocks.navigate,
}))
// Replace the camera and QR rendering only; exercise the real signing screens and callbacks.
vi.mock(import('../../../components/qr/bbqr-display'), () => ({ BBQrDisplay: () => createElement(Fragment) }))
vi.mock<PartialModuleMock<typeof BbqrScannerModule>>(import('../../../components/qr/bbqr-scanner'), () => ({
  BBQrScanner: ({ onPlainScan }: { onPlainScan?: (value: string) => void }) =>
    createElement(
      'button',
      {
        onClick: () => {
          assert.exists(onPlainScan)
          onPlainScan('c3ludGhldGljLXNpZ25hdHVyZQ==')
        },
      },
      'Scan signature',
    ),
}))
// These tRPC fixtures intentionally model only the query states exercised below.
vi.mock<{ trpc: unknown }>(import('../../../trpc'), async () => {
  const { useMutation, useQuery } = await import('@tanstack/react-query')
  return {
    trpc: {
      useUtils: () => ({
        portalProve: { registry: { claims: { get: { byId: { invalidate: mocks.invalidateClaim } } } } },
      }),
      portalProve: {
        registry: {
          claims: {
            get: {
              byId: {
                useQuery: ({ id }: { id: string }) =>
                  useQuery({
                    queryKey: ['claim', id],
                    queryFn: mocks.fetchClaim,
                    initialData: mocks.claim,
                    staleTime: Infinity,
                  }),
              },
            },
          },
          challenges: {
            complete: {
              useMutation: (options?: UseMutationOptions<void, Error, { challengeId: string }>) =>
                useMutation({ ...options, mutationFn: mocks.completeChallenge }),
            },
          },
          challengeMessages: {
            get: {
              useQuery: () => ({
                isLoading: false,
                data: {
                  signedMessage: {
                    id: 're_mesg_message1',
                    address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
                    messageTextToSign: 'Synthetic multisig ownership challenge',
                  },
                },
              }),
            },
            complete: { useMutation: () => useMutation({ mutationFn: mocks.completeMessage }) },
          },
        },
      },
    },
  }
})

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let router: ReturnType<typeof createMemoryRouter> | undefined

async function clickNext(): Promise<void> {
  const button = container.querySelector('svg.lucide-arrow-right')?.closest('button')
  assert.exists(button, 'Expected signing button')
  await act(async () => {
    button.click()
  })
}

async function waitForText(text: string): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    expect(container.textContent).toContain(text)
  })
}

async function reachSigning(): Promise<void> {
  await clickNext()
  await waitForText(`Proving Control With Your ${mocks.walletType === 'ledger' ? 'Ledger' : 'Trezor'}`)
  await clickNext()
  await waitForText('Prove Control')
}

function getSignButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Prove Control')
  assert.exists(button, 'Expected signing button')
  return button
}

async function clickSign(): Promise<void> {
  await act(async () => {
    getSignButton().click()
  })
}

async function render(page: ReactElement = createElement(MultisigSigningPage)): Promise<void> {
  await act(async () => {
    root.render(createElement(ChakraProvider, null, createElement(QueryClientProvider, { client: queryClient }, page)))
  })
}

async function renderSigningRoute(withWrapper = false): Promise<ReturnType<typeof createMemoryRouter>> {
  router = createMemoryRouter(
    [
      { path: '/accounts', element: createElement('div', null, 'Account list') },
      {
        element: withWrapper ? createElement(MultisigPageWrapper) : undefined,
        children: [
          { path: '/multisig/:id/signing/:walletType/:keystoreId', element: createElement(MultisigSigningPage) },
        ],
      },
      { path: '/multisig/verify/receipt/:id/:keystoreId', element: createElement('div', null, 'Key receipt') },
      { path: '/accounts/verify/receipt/:id', element: createElement('div', null, 'Verified account receipt') },
    ],
    {
      initialEntries: ['/accounts', `/multisig/re_clmx_claim1/signing/${mocks.walletType}/re_ks_ledger`],
      initialIndex: 1,
    },
  )
  await render(createElement(RouterProvider, { router }))
  return router
}

async function withTestSetup(run: () => Promise<void>, setup?: () => Promise<void>): Promise<void> {
  const domGlobals = mocks.acquireDom()
  const lifecycle = { finished: false }
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    lifecycle.finished = true

    try {
      await act(async () => {
        root.unmount()
      })
      router?.dispose()
      router = undefined
      queryClient.clear()
      container.remove()
    } finally {
      vi.unstubAllGlobals()
      domGlobals.window.close()
    }
  })
  vi.clearAllMocks()
  mocks.navigate.mockReset()
  mocks.walletType = 'ledger'
  for (const [name, value] of Object.entries(domGlobals)) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const xpubs = [
    'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
    'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz',
  ].map((value) => Slip132.getXpubFromString(value).expect('public test xpub'))
  const ledgerXpub = xpubs[0]
  const otherXpub = xpubs[1]
  assert.exists(ledgerXpub)
  assert.exists(otherXpub)
  const createdAt = new Date('2026-01-01T00:00:00Z')
  const keystoreDefaults = {
    createdAt,
    updatedAt: createdAt,
    wallet: null,
    model: null,
    isIdentified: false,
    derivationPath: DerivationPath.fromString('m/48h/0h/0h/2h').expect('valid fixture path').toString(),
  }
  mocks.claim = {
    id: 're_clmx_claim1',
    createdAt,
    updatedAt: createdAt,
    isVerified: false,
    officialName: '',
    displayName: 'Test multisig',
    network: 'bitcoin_mainnet',
    status: 'pending',
    isArchived: false,
    metadata: null,
    account: new MultiSigAccount('p2wsh', 2, true, xpubs).descriptor(),
    keystores: [
      { ...keystoreDefaults, id: 're_ks_ledger', label: 'Ledger', xpub: ledgerXpub },
      { ...keystoreDefaults, id: 're_ks_other', label: 'Other key', xpub: otherXpub },
    ],
    latestChallenge: {
      id: 're_chal_challenge1',
      completed: false,
      messages: [{ signedMessageId: 're_mesg_message1', keystoreId: 're_ks_ledger', signed: false }],
    },
  }
  mocks.ledger.isInitialized = false
  mocks.ledger.init.mockReset().mockResolvedValue(undefined)
  mocks.ledger.reset.mockReset().mockResolvedValue(undefined)
  mocks.ledger.signMessage.mockReset().mockResolvedValue(Ok({ v: 0, r: '11'.repeat(32), s: '22'.repeat(32) }))
  mocks.trezorSign.mockReset().mockResolvedValue(Ok({ signature: 'synthetic-trezor-signature' }))
  mocks.completeMessage.mockReset().mockResolvedValue(undefined)
  mocks.completeChallenge.mockReset().mockResolvedValue(undefined)
  mocks.fetchClaim.mockReset().mockResolvedValue(mocks.claim)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  mocks.invalidateClaim
    .mockReset()
    .mockImplementation(async (input: { id: string }, filters?: InvalidateQueryFilters, options?: InvalidateOptions) =>
      queryClient.invalidateQueries({ ...filters, queryKey: ['claim', input.id] }, options),
    )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  if (setup) {
    await setup()
  }
  if (lifecycle.finished) {
    return
  }
  await run()
}

describe('Ledger multisig signing screen', () => {
  async function setupLedgerSigning(): Promise<void> {
    await render()
  }

  it('advances through the real signing screens and submits the Ledger signature', async () => {
    await withTestSetup(async () => {
      expect(container.textContent).not.toContain('Unknown error')
      await reachSigning()
      expect(mocks.ledger.init).toHaveBeenCalledTimes(1)
      await clickSign()
      expect(mocks.ledger.signMessage).toHaveBeenCalledWith(
        "m/48'/0'/0'/2'/0/0",
        'Synthetic multisig ownership challenge',
      )
      expect(mocks.completeMessage).toHaveBeenCalledWith({
        signedMessageId: 're_mesg_message1',
        signature: Buffer.from([31, ...Buffer.alloc(32, 0x11), ...Buffer.alloc(32, 0x22)]).toString('base64'),
      })
      expect(mocks.completeChallenge).not.toHaveBeenCalled()
      expect(mocks.navigate).toHaveBeenCalledWith('/multisig/verify/receipt/re_clmx_claim1/re_ks_ledger', {
        replace: true,
      })
    }, setupLedgerSigning)
  })

  it('shows a real initialization failure and does not advance to signing', async () => {
    await withTestSetup(async () => {
      mocks.ledger.init.mockRejectedValue(new Error('Ledger disconnected'))
      await clickNext()
      await waitForText('Ledger disconnected')
      await clickNext()
      expect(container.textContent).not.toContain('Proving Control With Your Ledger')
      expect(mocks.ledger.signMessage).not.toHaveBeenCalled()
      expect(mocks.completeMessage).not.toHaveBeenCalled()
    }, setupLedgerSigning)
  })

  it('shows a rejected device signature without submitting or completing the challenge', async () => {
    await withTestSetup(async () => {
      mocks.ledger.signMessage.mockResolvedValue(Err(new HardwareDeviceError('Rejected', 'ledger', 'Signing canceled')))
      await reachSigning()
      await clickSign()
      await waitForText('Signing canceled')
      expect(container.textContent).not.toContain('Waiting for device confirmation')
      expect(mocks.completeMessage).not.toHaveBeenCalled()
      expect(mocks.completeChallenge).not.toHaveBeenCalled()
      expect(mocks.navigate).not.toHaveBeenCalled()
    }, setupLedgerSigning)
  })
})

describe.each(['ledger', 'trezor'] as const)('%s as the final multisig cosigner', (walletType) => {
  async function setupFinalCosigner(): Promise<void> {
    mocks.walletType = walletType
    const challenge = mocks.claim.latestChallenge
    assert.exists(challenge, 'Expected the claim challenge')
    assert.exists(challenge.messages[0], 'Expected the first challenge message')
    assert.exists(mocks.claim.keystores[1], 'Expected the second keystore')
    challenge.messages.push({
      ...challenge.messages[0],
      keystoreId: mocks.claim.keystores[1].id,
      signedMessageId: 're_mesg_message0',
      signed: true,
    })
    await render()
  }

  it('completes the challenge and navigates to the verified account receipt', async () => {
    await withTestSetup(async () => {
      await reachSigning()
      await clickSign()
      await vi.waitFor(() => {
        expect(mocks.navigate).toHaveBeenCalledWith('/accounts/verify/receipt/re_clmx_claim1')
      })
      expect(mocks.completeMessage).toHaveBeenCalledTimes(1)
      expect(mocks.completeChallenge).toHaveBeenCalledExactlyOnceWith({ challengeId: 're_chal_challenge1' })
      expect(mocks.invalidateClaim).toHaveBeenCalledWith({ id: 're_clmx_claim1' }, undefined, { throwOnError: true })
      expect(mocks.fetchClaim).toHaveBeenCalledTimes(1)
      expect(mocks.toastError).not.toHaveBeenCalled()
    }, setupFinalCosigner)
  })

  it('blocks another signing attempt until the final completion request finishes', async () => {
    await withTestSetup(async () => {
      let resolveCompletion!: () => void
      const pendingCompletion = new Promise<void>((resolve) => {
        resolveCompletion = resolve
      })
      mocks.completeChallenge.mockReturnValueOnce(pendingCompletion)
      await reachSigning()
      await clickSign()
      try {
        expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.invalidateClaim).not.toHaveBeenCalled()
        expect(getSignButton().disabled).toBe(true)
        await clickSign()
        expect(walletType === 'ledger' ? mocks.ledger.signMessage : mocks.trezorSign).toHaveBeenCalledTimes(1)
        expect(mocks.completeMessage).toHaveBeenCalledTimes(1)
        expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)
      } finally {
        await act(async () => {
          resolveCompletion()
        })
      }
      await vi.waitFor(() => {
        expect(mocks.navigate).toHaveBeenCalledWith('/accounts/verify/receipt/re_clmx_claim1')
      })
      expect(getSignButton().disabled).toBe(false)
    }, setupFinalCosigner)
  })

  it('blocks another signing attempt until the verified claim refresh finishes', async () => {
    await withTestSetup(async () => {
      let resolveRefresh!: () => void
      const pendingRefresh = new Promise<void>((resolve) => {
        resolveRefresh = resolve
      })
      mocks.fetchClaim.mockImplementationOnce(async () => {
        await pendingRefresh
        return mocks.claim
      })
      await reachSigning()
      await clickSign()
      try {
        expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)
        expect(mocks.invalidateClaim).toHaveBeenCalledWith({ id: 're_clmx_claim1' }, undefined, { throwOnError: true })
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(getSignButton().disabled).toBe(true)
        await clickSign()
        expect(walletType === 'ledger' ? mocks.ledger.signMessage : mocks.trezorSign).toHaveBeenCalledTimes(1)
        expect(mocks.completeMessage).toHaveBeenCalledTimes(1)
        expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)
      } finally {
        await act(async () => {
          resolveRefresh()
        })
      }
      await vi.waitFor(() => {
        expect(mocks.navigate).toHaveBeenCalledWith('/accounts/verify/receipt/re_clmx_claim1')
      })
      expect(getSignButton().disabled).toBe(false)
    }, setupFinalCosigner)
  })

  it('recovers from a failed claim refresh on reload without requesting another signature', async () => {
    await withTestSetup(async () => {
      mocks.fetchClaim.mockRejectedValueOnce(new Error('Sentinel account request failed'))
      await reachSigning()
      await clickSign()
      await vi.waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
          'Verification completed, but the account could not be refreshed. Reload the page.',
        )
      })
      expect(queryClient.getQueryState(['claim', 're_clmx_claim1'])).toMatchObject({ status: 'error' })
      expect(mocks.fetchClaim).toHaveBeenCalledTimes(1)
      expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)
      expect(mocks.invalidateClaim).toHaveBeenCalledWith({ id: 're_clmx_claim1' }, undefined, { throwOnError: true })
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(
        queryClient
          .getMutationCache()
          .getAll()
          .find((mutation) => mutation.options.mutationFn === mocks.completeChallenge)?.state.status,
      ).toBe('success')

      // Simulate reloading the signing URL with the completed claim returned by Sentinel.
      await act(async () => {
        root.render(null)
      })
      queryClient.clear()
      const completedChallenge = mocks.claim.latestChallenge
      assert.exists(completedChallenge, 'Expected the claim challenge')
      mocks.claim = {
        ...mocks.claim,
        isVerified: true,
        status: 'verified',
        latestChallenge: {
          ...completedChallenge,
          completed: true,
          messages: completedChallenge.messages.map((message) => Object.assign({}, message, { signed: true })),
        },
      }
      mocks.fetchClaim.mockResolvedValue(mocks.claim)
      const reloadedRouter = await renderSigningRoute()
      await waitForText('Verified account receipt')
      expect(reloadedRouter.state.location.pathname).toBe('/accounts/verify/receipt/re_clmx_claim1')
      expect(reloadedRouter.state.historyAction).toBe('REPLACE')
      expect(walletType === 'ledger' ? mocks.ledger.signMessage : mocks.trezorSign).toHaveBeenCalledTimes(1)
      expect(mocks.completeMessage).toHaveBeenCalledTimes(1)
      expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)

      await act(async () => {
        await reloadedRouter.navigate(-1)
      })
      await waitForText('Account list')
    }, setupFinalCosigner)
  })

  it('displays final completion failures without navigating to the receipt', async () => {
    await withTestSetup(async () => {
      mocks.completeChallenge.mockRejectedValueOnce(new Error('Sentinel could not complete verification'))
      await reachSigning()
      await clickSign()
      await waitForText('Sentinel could not complete verification')
      expect(container.textContent).not.toContain('Waiting for device confirmation')
      expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)
      expect(mocks.toastError).toHaveBeenCalledWith('There was an error when completing your Multisig claim')
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(mocks.invalidateClaim).not.toHaveBeenCalled()
    }, setupFinalCosigner)
  })
})

describe.each(['ledger', 'trezor'] as const)('%s verification of an already-verified account', (walletType) => {
  it('keeps a new incomplete challenge open for signing', async () => {
    await withTestSetup(async () => {
      mocks.walletType = walletType
      mocks.claim = { ...mocks.claim, isVerified: true, status: 'verified' }
      const signingRouter = await renderSigningRoute()
      await reachSigning()
      expect(signingRouter.state.location.pathname).toBe(`/multisig/re_clmx_claim1/signing/${walletType}/re_ks_ledger`)
      expect(getSignButton().disabled).toBe(false)
      expect(container.textContent).not.toContain('Verified account receipt')
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(mocks.completeChallenge).not.toHaveBeenCalled()
    })
  })
})

function signingProps(): SigningFlowProps {
  const claim = mocks.claim
  const keystore = claim.keystores[0]
  const latest = claim.latestChallenge
  assert.exists(keystore)
  assert.exists(latest)
  return {
    claim,
    keystore,
    challenge: {
      id: latest.id,
      claimId: claim.id,
      variant: 'signed_message',
      isSatisfied: latest.completed,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      completedAt: null,
    },
    challengeMessage: {
      challengeId: latest.id,
      keystoreId: keystore.id,
      signedMessage: {
        version: 0,
        id: 're_mesg_message1',
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
        address: Address.fromString('1BoatSLRHtKNngkdXEeobR76b53LETtpyT').expect('valid test address').toString(),
        messageTextToSign: 'Synthetic ownership challenge',
        signedAt: null,
        signature: null,
      },
    },
    onExitSigning: vi.fn<() => void>(),
    onSigningComplete: vi.fn<() => void>(),
  }
}

describe.each(['singlesig', 'multisig'] as const)('%s Ledger retry', (flow) => {
  it('releases the HID handle and reloads even when the SDK exchange is stuck', async () => {
    await withTestSetup(async () => {
      let finishClose: (() => void) | undefined
      const close = vi.fn(
        async () =>
          new Promise<void>((resolve) => {
            finishClose = resolve
          }),
      )
      const device = {
        opened: true,
        vendorId: 0x2c97,
        productId: 0,
        productName: 'Test Ledger',
        collections: [],
        oninputreport: null,
        addEventListener: vi.fn<() => void>(),
        removeEventListener: vi.fn<() => void>(),
        dispatchEvent: vi.fn(() => true),
        open: vi.fn(async () => undefined),
        close,
        forget: vi.fn(async () => undefined),
        sendReport: vi.fn(async () => undefined),
        sendFeatureReport: vi.fn(async () => undefined),
        receiveFeatureReport: vi.fn(async () => new DataView(new ArrayBuffer(0))),
      } satisfies HIDDevice
      const transport = new TransportWebHID(device)
      transport.exchangeBusyPromise = new Promise<void>(() => undefined)
      const sdkClose = vi.spyOn(transport, 'close')
      mocks.ledger.reset.mockImplementation(async (closeTransport?: (device: TransportWebHID) => Promise<void>) => {
        if (closeTransport) {
          await closeTransport(transport)
        }
      })
      mocks.ledger.init.mockRejectedValueOnce(new Error('Ledger connection failed'))
      if (flow === 'multisig') {
        await render()
      } else {
        const props = signingProps()
        await render(createElement(SinglesigLedgerSigning, props))
      }
      await clickNext()
      await waitForText('Ledger connection failed')
      const reload = vi.fn()
      vi.stubGlobal(
        'window',
        new Proxy(mocks.domGlobals.window, {
          get(target, key): unknown {
            // jsdom requires the real Window as the receiver for event-listener methods.
            if (key === 'addEventListener' || key === 'removeEventListener') {
              return target[key].bind(target)
            }
            return key === 'location' ? { reload } : Reflect.get(target, key, target)
          },
        }),
      )
      const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Retry')
      assert.exists(retry, 'Missing Retry button')
      await act(async () => {
        retry.click()
      })
      try {
        expect(sdkClose).not.toHaveBeenCalled()
        expect(close).toHaveBeenCalledOnce()
        expect(device.removeEventListener).toHaveBeenCalledWith('inputreport', transport.onInputReport)
        expect(reload).not.toHaveBeenCalled()
      } finally {
        if (finishClose) {
          const finish = finishClose
          await act(async () => {
            finish()
          })
        }
      }
      await vi.waitFor(() => {
        expect(reload).toHaveBeenCalledOnce()
      })
      expect(mocks.toastError).not.toHaveBeenCalled()
    })
  })
})

type AirgappedFlow = 'coldcard-file' | 'coldcard-qr' | 'keystone'

async function clickButton(text: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find((element) => element.textContent === text)
  assert.exists(button, 'Expected signing button')
  await act(async () => {
    button.click()
  })
}

async function reachAirgappedSigning(flow: AirgappedFlow): Promise<void> {
  await clickNext()
  if (flow !== 'keystone') {
    await clickNext()
  }
  if (flow === 'coldcard-file') {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const copy = container.querySelector('svg.lucide-copy')?.closest('button')
    assert.exists(copy, 'Missing copy button')
    await act(async () => {
      copy.click()
    })
    await clickButton('Next')
    await clickButton('Next')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    assert.exists(input, 'Missing signature file input')
    const contents = [
      '-----BEGIN BITCOIN SIGNED MESSAGE-----',
      'Synthetic multisig ownership challenge',
      '-----BEGIN BITCOIN SIGNATURE-----',
      '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      'c3ludGhldGljLXNpZ25hdHVyZQ==',
      '-----END BITCOIN SIGNATURE-----',
    ].join('\n')
    Object.defineProperty(input, 'files', {
      value: [new mocks.domGlobals.window.File([contents], 'signature.txt', { type: 'text/plain' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForText('Prove Control')
  } else {
    await clickButton('Next')
    await clickButton('Ready to Scan')
    await waitForText('Scan signature')
  }
}

async function submitAirgappedSignature(flow: AirgappedFlow): Promise<void> {
  await clickButton(flow === 'coldcard-file' ? 'Prove Control' : 'Scan signature')
}

describe.each(['coldcard-file', 'coldcard-qr', 'keystone'] as const)('%s multisig completion', (flow) => {
  async function setupAirgappedSigning(): Promise<void> {
    mocks.walletType = flow === 'keystone' ? 'keystone' : 'coldcard'
    assert.exists(mocks.claim.keystores[0], 'Expected the first keystore')
    mocks.claim.keystores[0].model = flow === 'coldcard-qr' ? 'Q' : 'MK4'
  }

  it('waits for the claim refresh before opening the partial receipt', async () => {
    await withTestSetup(async () => {
      let finishRefresh!: () => void
      const pending = new Promise<void>((resolve) => {
        finishRefresh = resolve
      })
      mocks.fetchClaim.mockImplementationOnce(async () => {
        await pending
        return mocks.claim
      })
      await renderSigningRoute()
      await reachAirgappedSigning(flow)
      await submitAirgappedSignature(flow)
      try {
        await vi.waitFor(() => {
          expect(mocks.fetchClaim).toHaveBeenCalledOnce()
        })
        expect(mocks.completeMessage).toHaveBeenCalledExactlyOnceWith({
          signedMessageId: 're_mesg_message1',
          signature: 'c3ludGhldGljLXNpZ25hdHVyZQ==',
        })
        expect(mocks.completeChallenge).not.toHaveBeenCalled()
        expect(mocks.navigate).not.toHaveBeenCalled()
      } finally {
        await act(async () => {
          finishRefresh()
        })
      }
      await vi.waitFor(() => {
        expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/multisig/verify/receipt/re_clmx_claim1/re_ks_ledger', {
          replace: true,
        })
      })
    }, setupAirgappedSigning)
  })

  it('handles a rejected refresh without opening the receipt', async () => {
    await withTestSetup(async () => {
      mocks.fetchClaim.mockRejectedValueOnce(new Error('Synthetic refresh failure'))
      await renderSigningRoute()
      await reachAirgappedSigning(flow)
      await submitAirgappedSignature(flow)
      await vi.waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith(
          'Signature saved, but the account could not be refreshed. Retry loading the account.',
        )
      })
      expect(mocks.completeMessage).toHaveBeenCalledOnce()
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(mocks.completeChallenge).not.toHaveBeenCalled()
    }, setupAirgappedSigning)
  })

  it('handles rejected signatures without refreshing or completing the challenge', async () => {
    await withTestSetup(async () => {
      mocks.completeMessage.mockRejectedValueOnce(new Error('Synthetic signature rejection'))
      await renderSigningRoute()
      await reachAirgappedSigning(flow)
      await submitAirgappedSignature(flow)
      await waitForText('Error completing challenge message')
      expect(mocks.toastError).toHaveBeenCalledWith('The signing process did not complete successfully.')
      expect(mocks.fetchClaim).not.toHaveBeenCalled()
      expect(mocks.completeChallenge).not.toHaveBeenCalled()
      expect(mocks.navigate).not.toHaveBeenCalled()
    }, setupAirgappedSigning)
  })

  it('waits for final completion before refreshing the verified account', async () => {
    await withTestSetup(async () => {
      const challenge = mocks.claim.latestChallenge
      assert.exists(challenge, 'Expected the claim challenge')
      assert.exists(challenge.messages[0], 'Expected the first challenge message')
      assert.exists(mocks.claim.keystores[1], 'Expected the second keystore')
      challenge.messages.push({
        ...challenge.messages[0],
        keystoreId: mocks.claim.keystores[1].id,
        signedMessageId: 're_mesg_message0',
        signed: true,
      })
      let finishCompletion!: () => void
      const pending = new Promise<void>((resolve) => {
        finishCompletion = resolve
      })
      mocks.completeChallenge.mockReturnValueOnce(pending)
      await renderSigningRoute()
      await reachAirgappedSigning(flow)
      await submitAirgappedSignature(flow)
      try {
        await vi.waitFor(() => {
          expect(mocks.completeChallenge).toHaveBeenCalledExactlyOnceWith({ challengeId: 're_chal_challenge1' })
        })
        expect(mocks.fetchClaim).not.toHaveBeenCalled()
        expect(mocks.navigate).not.toHaveBeenCalled()
      } finally {
        await act(async () => {
          finishCompletion()
        })
      }
      await vi.waitFor(() => {
        expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/accounts/verify/receipt/re_clmx_claim1')
      })
      expect(mocks.fetchClaim).toHaveBeenCalledOnce()
      expect(mocks.toastError).not.toHaveBeenCalled()
    }, setupAirgappedSigning)
  })

  it('handles final completion failures without opening a receipt', async () => {
    await withTestSetup(async () => {
      const challenge = mocks.claim.latestChallenge
      assert.exists(challenge, 'Expected the claim challenge')
      assert.exists(challenge.messages[0], 'Expected the first challenge message')
      assert.exists(mocks.claim.keystores[1], 'Expected the second keystore')
      challenge.messages.push({
        ...challenge.messages[0],
        keystoreId: mocks.claim.keystores[1].id,
        signedMessageId: 're_mesg_message0',
        signed: true,
      })
      mocks.completeChallenge.mockRejectedValueOnce(new Error('Synthetic final completion failure'))
      await renderSigningRoute()
      await reachAirgappedSigning(flow)
      await submitAirgappedSignature(flow)
      await vi.waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith('The signing process did not complete successfully.')
      })
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(mocks.fetchClaim).not.toHaveBeenCalled()
    }, setupAirgappedSigning)
  })
})

describe('Trezor connection callback', () => {
  it.each(['result', 'rejection'] as const)('clears loading after a %s failure and permits retry', async (failure) => {
    await withTestSetup(async () => {
      const error = new Error('Synthetic connection failure')
      const onConnectTrezor = vi.fn<Parameters<typeof TrezorInfo>[0]['onConnectTrezor']>()
      if (failure === 'result') {
        onConnectTrezor.mockResolvedValueOnce(Err(error))
      } else {
        onConnectTrezor.mockRejectedValueOnce(error)
      }
      onConnectTrezor.mockResolvedValue(Ok())
      await render(createElement(TrezorInfo, { onBack: vi.fn<() => void>(), onConnectTrezor }))
      await clickButton('Next')
      await waitForText('Synthetic connection failure')
      expect(container.textContent).not.toContain('Awaiting account selection')
      await clickButton('Next')
      expect(onConnectTrezor).toHaveBeenCalledTimes(2)
      expect(container.textContent).not.toContain('Synthetic connection failure')
      expect(container.textContent).not.toContain('Awaiting account selection')
    })
  })
})

describe('Trezor singlesig callback', () => {
  it('clears signing progress after an unexpected SDK rejection', async () => {
    await withTestSetup(async () => {
      mocks.walletType = 'trezor'
      mocks.trezorSign.mockRejectedValueOnce(new Error('Unexpected Trezor failure'))
      const props = signingProps()
      await render(createElement(SinglesigTrezorSigning, props))
      await reachSigning()
      await clickSign()
      await waitForText('Unexpected Trezor failure')
      expect(container.textContent).not.toContain('Waiting for device confirmation')
      expect(mocks.completeMessage).not.toHaveBeenCalled()
      expect(mocks.completeChallenge).not.toHaveBeenCalled()
      expect(props.onSigningComplete).not.toHaveBeenCalled()
    })
  })
})

describe.each(['coldcard-file', 'coldcard-qr', 'keystone'] as const)('%s saved-signature recovery', (flow) => {
  it.each(['retry', 'reload'] as const)(
    'recovers through the real page wrapper on %s without resubmitting',
    async (recovery) => {
      await withTestSetup(async () => {
        mocks.walletType = flow === 'keystone' ? 'keystone' : 'coldcard'
        assert.exists(mocks.claim.keystores[0], 'Expected the first keystore')
        mocks.claim.keystores[0].model = flow === 'coldcard-qr' ? 'Q' : 'MK4'
        mocks.fetchClaim.mockRejectedValueOnce(new Error('Temporary account refresh failure'))
        mocks.completeMessage
          .mockResolvedValueOnce(undefined)
          .mockRejectedValue(new Error('Signed message already completed'))
        await renderSigningRoute(true)
        await reachAirgappedSigning(flow)
        await submitAirgappedSignature(flow)
        await waitForText('An error occurred while loading the claim')
        expect(mocks.toastError).toHaveBeenCalledWith(
          'Signature saved, but the account could not be refreshed. Retry loading the account.',
        )
        const challenge = mocks.claim.latestChallenge
        assert.exists(challenge, 'Expected the claim challenge')
        const savedClaim = {
          ...mocks.claim,
          latestChallenge: {
            ...challenge,
            messages: challenge.messages.map((message) => Object.assign({}, message, { signed: true })),
          },
        }
        mocks.fetchClaim.mockResolvedValue(savedClaim)
        if (recovery === 'retry') {
          await clickButton('Retry')
        } else {
          await act(async () => {
            root.render(null)
          })
          router?.dispose()
          queryClient.clear()
          mocks.claim = savedClaim
          await renderSigningRoute(true)
        }
        await waitForText('Key receipt')
        assert.exists(router, 'Expected the signing router')
        expect(router.state.location.pathname).toBe('/multisig/verify/receipt/re_clmx_claim1/re_ks_ledger')
        expect(router.state.historyAction).toBe('REPLACE')
        expect(mocks.completeMessage).toHaveBeenCalledOnce()
        expect(mocks.completeChallenge).not.toHaveBeenCalled()
      })
    },
  )
})

it('resumes final verification from saved signatures and permits retry without signing again', async () => {
  await withTestSetup(async () => {
    const challenge = mocks.claim.latestChallenge
    assert.exists(challenge, 'Expected the claim challenge')
    assert.exists(challenge.messages[0], 'Expected the first challenge message')
    assert.exists(mocks.claim.keystores[1], 'Expected the second keystore')
    mocks.claim = {
      ...mocks.claim,
      latestChallenge: {
        ...challenge,
        messages: [
          { ...challenge.messages[0], signed: true },
          { ...challenge.messages[0], keystoreId: mocks.claim.keystores[1].id, signed: true },
        ],
      },
    }
    mocks.completeChallenge.mockRejectedValueOnce(new Error('Temporary completion failure'))
    assert.exists(mocks.claim.latestChallenge, 'Expected the claim challenge')
    mocks.fetchClaim.mockResolvedValue({
      ...mocks.claim,
      latestChallenge: { ...mocks.claim.latestChallenge, completed: true },
    })
    await renderSigningRoute(true)
    await clickButton('Finish verification')
    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('There was an error when completing your Multisig claim')
    })
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0)
        })
      })
      expect(
        Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Finish verification')
          ?.disabled,
      ).toBe(false)
    })
    await clickButton('Finish verification')
    await waitForText('Verified account receipt')
    expect(mocks.completeMessage).not.toHaveBeenCalled()
    expect(mocks.ledger.signMessage).not.toHaveBeenCalled()
    expect(mocks.trezorSign).not.toHaveBeenCalled()
    expect(mocks.completeChallenge).toHaveBeenCalledTimes(2)
  })
})

it('does not submit a second Coldcard file signature while the first is pending', async () => {
  await withTestSetup(async () => {
    mocks.walletType = 'coldcard'
    assert.exists(mocks.claim.keystores[0], 'Expected the first keystore')
    mocks.claim.keystores[0].model = 'MK4'
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    mocks.completeMessage.mockReturnValueOnce(pending)
    await renderSigningRoute()
    await reachAirgappedSigning('coldcard-file')
    try {
      await submitAirgappedSignature('coldcard-file')
      await submitAirgappedSignature('coldcard-file')
      expect(mocks.completeMessage).toHaveBeenCalledOnce()
    } finally {
      await act(async () => {
        finish()
      })
    }
  })
})

it.each(['ledger', 'trezor'] as const)(
  'returns to the previous page with one Back after a %s signature',
  async (walletType) => {
    await withTestSetup(async () => {
      mocks.walletType = walletType
      const challenge = mocks.claim.latestChallenge
      assert.exists(challenge, 'Expected the claim challenge')
      mocks.fetchClaim.mockResolvedValue({
        ...mocks.claim,
        latestChallenge: {
          ...challenge,
          messages: challenge.messages.map((message) => Object.assign({}, message, { signed: true })),
        },
      })
      const signingRouter = await renderSigningRoute(true)
      mocks.navigate.mockImplementation(signingRouter.navigate.bind(signingRouter))
      await reachSigning()
      await clickSign()
      await waitForText('Key receipt')
      await act(async () => {
        await signingRouter.navigate(-1)
      })
      await waitForText('Account list')
      expect(signingRouter.state.location.pathname).toBe('/accounts')
      expect(mocks.completeMessage).toHaveBeenCalledOnce()
    })
  },
)

it.each(['identified', 'verified'] as const)(
  'preserves a key’s %s status when its device type is unknown',
  async (status) => {
    await withTestSetup(async () => {
      const keystore = mocks.claim.keystores[0]
      const message = mocks.claim.latestChallenge?.messages[0]
      assert(keystore && message)
      keystore.isIdentified = true
      message.signed = status === 'verified'
      expect(getIndicatorKeystores(mocks.claim)).toContainEqual(
        expect.objectContaining({ id: keystore.id, status, wallet: null }),
      )
    })
  },
)

it.each([1, 2])('preserves Chakra visibility styles across test documents (%s)', async () => {
  await withTestSetup(async () => {
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(Box, { 'data-style-probe': true, display: 'none' }, 'Style probe'),
        ),
      )
    })
    const probe = container.querySelector('[data-style-probe]')
    assert.exists(probe)
    expect(getComputedStyle(probe).display).toBe('none')

    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(Box, { 'data-style-probe': true, display: 'flex' }, 'Style probe'),
        ),
      )
    })
    expect(getComputedStyle(probe).display).toBe('flex')
  })
})
