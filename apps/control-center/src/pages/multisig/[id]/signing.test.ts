// @vitest-environment node
import { Box } from '@chakra-ui/react'
import { Address, DerivationPath, MultiSigAccount } from '@hoseki/packages/bitcoin'
import { hasKey } from '@hoseki/packages/lib/util'
import { AsyncOk, Err, Ok, parseUnknown } from '@hoseki/packages/result'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { TrezorInfo } from '@hoseki/packages/ui/wallet-ui/trezor/trezor-info'
import { HardwareDeviceError, Slip132 } from '@hoseki/packages/wallet'
import TransportWebHID from '@ledgerhq/hw-transport-webhid'
import { QueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { type ReactElement, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { Outlet } from 'react-router'
import { toast } from 'sonner'
import { type MockInstance, assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { LedgerSigning as SinglesigLedgerSigning } from '../../../components/claims/ledger/ledger-signing'
import { trezorService } from '../../../components/claims/trezor/trezor-service-singleton'
import { TrezorSigning as SinglesigTrezorSigning } from '../../../components/claims/trezor/trezor-signing'
import { MultisigPageWrapper, getIndicatorKeystores } from '../../../components/multisig/multisig-page-wrapper'
import { type QrCamera, type QrCameraFactory, QrCameraProvider } from '../../../components/qr/bbqr-scanner'
import { useLedgerStore } from '../../../hooks/use-ledger-store'
import type { SigningFlowProps } from '../../../lib/claim-flow'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { type RouterOutput, trpc } from '../../../trpc'
import type { ChallengeMessageDto, ClaimDto } from '../../../trpc/server-types'
import { MultisigDetailsPage } from './index'
import { MultisigSigningPage } from './signing'

const mocks = await vi.hoisted(async () => {
  // Add a DOM without replacing Node byte-array globals used by the Bitcoin SDK.
  const { JSDOM } = await import('jsdom')
  const { installAnimationPlaceholder } = await import('@hoseki/packages/testing/animation-dom')
  function createDom() {
    const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
    })
    installAnimationPlaceholder(window.HTMLCanvasElement)
    const imageConstructor: unknown = window['Image']
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
      Image: imageConstructor,
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
  let walletType: 'ledger' | 'trezor' | 'coldcard' | 'keystone' = 'ledger'
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
    get walletType() {
      return walletType
    },
    set walletType(value: 'ledger' | 'trezor' | 'coldcard' | 'keystone') {
      walletType = value
    },
    ledger: {
      isInitialized: false,
      init: vi.fn(),
      reset: vi.fn(),
      signMessage:
        vi.fn<
          (
            ...args: Parameters<ReturnType<typeof useLedgerStore.getState>['signMessage']>
          ) => Promise<Awaited<ReturnType<ReturnType<typeof useLedgerStore.getState>['signMessage']>>>
        >(),
    },
    trezorSign:
      vi.fn<
        (
          ...args: Parameters<typeof trezorService.signCustomMessage>
        ) => Promise<Awaited<ReturnType<typeof trezorService.signCustomMessage>>>
      >(),
    navigate: vi.fn(),
    completeMessage: vi.fn<(input: { signedMessageId: string; signature: string }) => Promise<void>>(),
    completeChallenge: vi.fn<(input: { challengeId: string }) => Promise<void>>(),
    fetchClaim: vi.fn<() => Promise<ClaimDto>>(),
    toastError: vi.fn(),
  }
})

const claimQueryKey = getQueryKey(trpc.portalProve.registry.claims.get.byId, { id: 're_clmx_claim1' }, 'query')
let invalidateClaim: MockInstance<QueryClient['invalidateQueries']>
const rpc = createTestTrpcClient(async ({ path, input }) => {
  switch (path) {
    case 'portalProve.registry.claims.get.byId':
      return mocks.fetchClaim()
    case 'portalProve.registry.challengeMessages.get':
      return challengeMessage()
    case 'portalProve.registry.challengeMessages.complete': {
      await mocks.completeMessage(
        parseUnknown(z.object({ signedMessageId: z.string(), signature: z.string() }), input).expect(
          'Expected a signed-message completion input',
        ),
      )
      const message = challengeMessage()
      return {
        ...message,
        signedMessage: { ...message.signedMessage, signedAt: new Date(), signature: 'synthetic-signature' },
      } satisfies ChallengeMessageDto
    }
    case 'portalProve.registry.challenges.complete':
      await mocks.completeChallenge(
        parseUnknown(z.object({ challengeId: z.string() }), input).expect('Expected a challenge completion input'),
      )
      return {
        id: 're_chal_challenge1',
        claimId: mocks.claim.id,
        variant: 'signed_message',
        isSatisfied: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      } satisfies RouterOutput['portalProve']['registry']['challenges']['complete']
    default:
      throw new Error(`Unexpected signing request: ${path}`)
  }
})
function challengeMessage(): ChallengeMessageDto {
  return {
    signedMessage: {
      version: 0 as const,
      id: 're_mesg_message1',
      address: Address.fromString('1BoatSLRHtKNngkdXEeobR76b53LETtpyT').expect('valid challenge address').toString(),
      messageTextToSign: 'Synthetic multisig ownership challenge',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      signedAt: null,
      signature: null,
    },
    challengeId: 're_chal_challenge1',
    keystoreId: 're_ks_ledger',
  }
}
let scanText: (text: string) => void = () => {
  throw new Error('Camera has not started')
}
const cameraFactory: QrCameraFactory = {
  getCameras: async () => [{ id: 'signing-camera', label: 'Signing camera' }],
  create: () => {
    const camera: QrCamera = {
      isScanning: false,
      start: async (_id, _config, onSuccess) => {
        assert.exists(onSuccess, 'Expected QR success callback')
        camera.isScanning = true
        scanText = (text) => {
          onSuccess(text, { decodedText: text, result: { text } })
        }
        return null
      },
      stop: async () => {
        camera.isScanning = false
      },
      clear: () => undefined,
    }
    return camera
  },
}
function SigningOutlet(): JSX.Element {
  return createElement(Outlet, { context: { claim: mocks.claim, indicatorKeystores: [], expandedKeystore: null } })
}
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

async function render(page?: ReactElement): Promise<void> {
  if (!page) {
    await renderSigningRoute()
    return
  }
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          TestTrpcProvider,
          { client: queryClient, rpc },
          createElement(QrCameraProvider, { value: cameraFactory }, page),
        ),
      ),
    )
  })
}

async function renderSigningRoute(
  withWrapper = false,
  cachedClaim?: ClaimDto,
): Promise<ReturnType<typeof createMemoryRouter>> {
  queryClient.setQueryData(claimQueryKey, cachedClaim ?? mocks.claim)
  if (cachedClaim) {
    // Like the app's default stale time: the page refetches this claim when it opens.
    queryClient.getQueryCache().find(claimQueryKey)?.invalidate()
  }
  queryClient.setQueryData(
    getQueryKey(trpc.portalProve.registry.challengeMessages.get, { signedMessageId: 're_mesg_message1' }, 'query'),
    challengeMessage(),
  )
  router?.dispose()
  router = createMemoryRouter(
    [
      { path: '/accounts', element: createElement('div', null, 'Account list') },
      {
        element: withWrapper ? createElement(MultisigPageWrapper) : createElement(SigningOutlet),
        children: [
          { path: '/multisig/:claimId', element: createElement(MultisigDetailsPage) },
          { path: '/multisig/:claimId/signing/:walletType/:keystoreId', element: createElement(MultisigSigningPage) },
          {
            path: '/multisig/:claimId/connect/:walletType/:keystoreId',
            element: createElement('div', null, 'Connect device'),
          },
        ],
      },
      { path: '/multisig/verify/receipt/:claimId/:keystoreId', element: createElement('div', null, 'Key receipt') },
      { path: '/accounts/verify/receipt/:claimId', element: createElement('div', null, 'Verified account receipt') },
    ],
    {
      initialEntries: ['/accounts', `/multisig/re_clmx_claim1/signing/${mocks.walletType}/re_ks_ledger`],
      initialIndex: 1,
    },
  )
  const navigate = router.navigate.bind(router)
  vi.spyOn(router, 'navigate').mockImplementation(async (to, options) => {
    if (options?.replace === true) {
      mocks.navigate(to, { replace: true })
    } else {
      mocks.navigate(to)
    }
    if (isHistoryDelta(to)) {
      await navigate(to)
    } else {
      await navigate(to, options)
    }
  })
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
      useLedgerStore.setState(useLedgerStore.getInitialState(), true)
      vi.restoreAllMocks()
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
  useLedgerStore.setState(useLedgerStore.getInitialState(), true)
  useLedgerStore.setState({
    init: mocks.ledger.init,
    reset: mocks.ledger.reset,
    signMessage: (path: string, message: string) =>
      AsyncOk(path).andThenAsync(async (signingPath) => mocks.ledger.signMessage(signingPath, message)),
  })
  vi.spyOn(trezorService, 'signCustomMessage').mockImplementation((path: string, message: string) =>
    AsyncOk(path).andThenAsync(async (signingPath) => mocks.trezorSign(signingPath, message)),
  )
  vi.spyOn(toast, 'error').mockImplementation((...args) => {
    mocks.toastError(...args)
    return 'test-toast'
  })
  mocks.ledger.init.mockReset().mockResolvedValue(undefined)
  mocks.ledger.reset.mockReset().mockResolvedValue(undefined)
  mocks.ledger.signMessage.mockReset().mockResolvedValue(Ok({ v: 0, r: '11'.repeat(32), s: '22'.repeat(32) }))
  mocks.trezorSign
    .mockReset()
    .mockResolvedValue(Ok({ signature: 'synthetic-trezor-signature', address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' }))
  mocks.completeMessage.mockReset().mockResolvedValue(undefined)
  mocks.completeChallenge.mockReset().mockResolvedValue(undefined)
  mocks.fetchClaim.mockReset().mockResolvedValue(mocks.claim)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  invalidateClaim = vi.spyOn(queryClient, 'invalidateQueries')
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

it.each([false, true])('resumes an identified wallet with a saved message: %s', async (hasMessage) => {
  await withTestSetup(async () => {
    const challenge = mocks.claim.latestChallenge
    const keystore = mocks.claim.keystores[0]
    assert.exists(challenge)
    assert.exists(keystore)
    keystore.isIdentified = true
    keystore.wallet = 'ledger'
    keystore.model = 'nanoX'
    if (!hasMessage) {
      challenge.messages = []
    }
    expect(getIndicatorKeystores(mocks.claim)[0]?.status).toBe('identified')
    const signingRouter = await renderSigningRoute(true)
    await act(async () => {
      await signingRouter.navigate('/multisig/re_clmx_claim1?keystoreId=re_ks_ledger')
    })
    await waitForText('Continue')
    await clickButton('Continue')
    await vi.waitFor(() => {
      const step = hasMessage ? 'signing' : 'connect'
      expect(signingRouter.state.location.pathname).toBe(`/multisig/re_clmx_claim1/${step}/ledger/re_ks_ledger`)
    })
    expect(mocks.completeMessage).not.toHaveBeenCalled()
    expect(mocks.completeChallenge).not.toHaveBeenCalled()
  })
})

function identifyLedgerKeystore(): void {
  const keystore = mocks.claim.keystores[0]
  assert.exists(keystore)
  keystore.isIdentified = true
  keystore.wallet = 'ledger'
  keystore.model = 'nanoX'
}

it('sends a directly opened signing page without a saved message to the connect step', async () => {
  await withTestSetup(async () => {
    identifyLedgerKeystore()
    assert.exists(mocks.claim.latestChallenge)
    mocks.claim.latestChallenge.messages = []
    const signingRouter = await renderSigningRoute(true)
    await vi.waitFor(() => {
      expect(signingRouter.state.location.pathname).toBe('/multisig/re_clmx_claim1/connect/ledger/re_ks_ledger')
    })
    await waitForText('Connect device')
    expect(mocks.completeMessage).not.toHaveBeenCalled()
  })
})

it('waits for the refreshed claim before deciding a signing message is missing', async () => {
  await withTestSetup(async () => {
    identifyLedgerKeystore()
    const challenge = mocks.claim.latestChallenge
    assert.exists(challenge)
    const staleClaim = { ...mocks.claim, latestChallenge: { ...challenge, messages: [] } }
    const signingRouter = await renderSigningRoute(true, staleClaim)
    await vi.waitFor(() => {
      expect(mocks.fetchClaim).toHaveBeenCalled()
      expect(container.querySelector('svg.lucide-arrow-right')).not.toBeNull()
    })
    expect(signingRouter.state.location.pathname).toBe('/multisig/re_clmx_claim1/signing/ledger/re_ks_ledger')
    expect(container.textContent).not.toContain('Connect device')
  })
})

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
      expect(invalidateClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: getQueryKey(trpc.portalProve.registry.claims.get.byId, { id: 're_clmx_claim1' }),
        }),
        { throwOnError: true },
      )
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
        expect(invalidateClaim).not.toHaveBeenCalled()
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
      expect(router?.state.location.pathname).toBe('/accounts/verify/receipt/re_clmx_claim1')
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
        expect(invalidateClaim).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: getQueryKey(trpc.portalProve.registry.claims.get.byId, { id: 're_clmx_claim1' }),
          }),
          { throwOnError: true },
        )
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
      expect(router?.state.location.pathname).toBe('/accounts/verify/receipt/re_clmx_claim1')
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
      expect(queryClient.getQueryState(claimQueryKey)).toMatchObject({ status: 'error' })
      expect(mocks.fetchClaim).toHaveBeenCalledTimes(1)
      expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)
      expect(invalidateClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: getQueryKey(trpc.portalProve.registry.claims.get.byId, { id: 're_clmx_claim1' }),
        }),
        { throwOnError: true },
      )
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(
        queryClient
          .getMutationCache()
          .getAll()
          .find(
            (mutation) =>
              JSON.stringify(mutation.options.mutationKey) ===
              JSON.stringify([['portalProve', 'registry', 'challenges', 'complete']]),
          )?.state.status,
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
      expect(invalidateClaim).not.toHaveBeenCalled()
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

function isHistoryDelta(to: unknown): to is number {
  return typeof to === 'number'
}

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
          get(target, key) {
            // jsdom requires the real Window as the receiver for event-listener methods.
            if (key === 'addEventListener' || key === 'removeEventListener') {
              return target[key].bind(target)
            }
            if (key === 'location') {
              return { reload }
            }
            const value: unknown = hasKey(target, key) ? target[key] : undefined
            return value
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
    await waitForText('Point your webcam at the QR code...')
  }
}

async function submitAirgappedSignature(flow: AirgappedFlow): Promise<void> {
  if (flow === 'coldcard-file') {
    await clickButton('Prove Control')
  } else {
    await act(async () => {
      scanText('c3ludGhldGljLXNpZ25hdHVyZQ==')
    })
  }
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
