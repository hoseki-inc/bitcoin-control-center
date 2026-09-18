// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { MultiSigAccount } from '@hoseki/packages/bitcoin'
import { Err, Ok } from '@hoseki/packages/result'
import { HardwareDeviceError, Slip132 } from '@hoseki/packages/wallet'
import { QueryClient, QueryClientProvider, type UseMutationOptions } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import type * as ReactRouter from 'react-router'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimDto } from '../../../trpc/server-types'
import { MultisigSigningPage } from './signing'

const mocks = await vi.hoisted(async () => {
  // Add a DOM without replacing Node byte-array globals used by the Bitcoin SDK.
  const { createRequire } = await import('node:module')
  const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
    JSDOM: new (
      html: string,
      options: { url: string; pretendToBeVisual: boolean },
    ) => { window: Window & typeof globalThis }
  }
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  })
  const domGlobals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  }
  for (const [name, value] of Object.entries(domGlobals)) {
    vi.stubGlobal(name, value)
  }
  return {
    domGlobals,
    claim: {} as ClaimDto,
    walletType: 'ledger' as 'ledger' | 'trezor',
    ledger: { isInitialized: false, init: vi.fn(), reset: vi.fn(), signMessage: vi.fn() },
    trezorSign: vi.fn(),
    navigate: vi.fn(),
    completeMessage: vi.fn(),
    completeChallenge: vi.fn(),
    refetch: vi.fn(),
    invalidateClaim: vi.fn(),
    toastError: vi.fn(),
  }
})

vi.mock('../../../hooks/use-ledger-store', () => ({
  useLedgerStore: (selector: (state: typeof mocks.ledger) => unknown) => selector(mocks.ledger),
  useToastOnLedgerDisconnect: () => undefined,
}))
vi.mock('../../../components/multisig/multisig-page-wrapper', () => ({
  useMultisigPageWrapperContext: () => ({ claim: mocks.claim }),
}))
vi.mock('../../../components/claims/trezor/trezor-service-singleton', () => ({
  trezorService: { signCustomMessage: mocks.trezorSign },
}))
vi.mock('../../../logger', () => ({
  browserLogger: { error: vi.fn() },
  captureHardwareWalletError: vi.fn(),
}))
vi.mock('lottie-react', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useParams: () => ({ walletType: mocks.walletType, keystoreId: 'ledger-key' }),
  useNavigate: () => mocks.navigate,
}))
vi.mock('../../../trpc', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return {
    trpc: {
      useUtils: () => ({
        portalProve: { registry: { claims: { get: { byId: { invalidate: mocks.invalidateClaim } } } } },
      }),
      portalProve: {
        registry: {
          claims: { get: { byId: { useQuery: () => ({ data: mocks.claim, refetch: mocks.refetch }) } } },
          challenges: {
            complete: {
              useMutation: (options: UseMutationOptions<void, Error, { challengeId: string }>) =>
                useMutation({ ...options, mutationFn: mocks.completeChallenge }),
            },
          },
          challengeMessages: {
            get: {
              useQuery: () => ({
                isLoading: false,
                data: {
                  signedMessage: {
                    id: 'message-1',
                    address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
                    messageTextToSign: 'Synthetic multisig ownership challenge',
                  },
                },
              }),
            },
            complete: { useMutation: () => ({ mutateAsync: mocks.completeMessage }) },
          },
        },
      },
    },
  }
})

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient

async function clickNext(): Promise<void> {
  const button = container.querySelector('svg.lucide-arrow-right')?.closest('button')
  expect(button).toBeDefined()
  await act(async () => button!.click())
}

async function waitForText(text: string): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
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
  expect(button).toBeDefined()
  return button!
}

async function clickSign(): Promise<void> {
  await act(async () => getSignButton().click())
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(QueryClientProvider, { client: queryClient }, createElement(MultisigSigningPage)),
      ),
    )
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.walletType = 'ledger'
  for (const [name, value] of Object.entries(mocks.domGlobals)) {
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
  mocks.claim = {
    id: 'claim-1',
    account: new MultiSigAccount('p2wsh', 2, true, xpubs).descriptor(),
    keystores: [
      { id: 'ledger-key', derivationPath: 'm/48h/0h/0h/2h', xpub: xpubs[0] },
      { id: 'other-key', derivationPath: 'm/48h/0h/0h/2h', xpub: xpubs[1] },
    ],
    latestChallenge: {
      id: 'challenge-1',
      completed: false,
      messages: [{ signedMessageId: 'message-1', keystoreId: 'ledger-key', signed: false }],
    },
  } as unknown as ClaimDto
  mocks.ledger.isInitialized = false
  mocks.ledger.init.mockReset().mockResolvedValue(undefined)
  mocks.ledger.reset.mockReset().mockResolvedValue(undefined)
  mocks.ledger.signMessage.mockReset().mockResolvedValue(Ok({ v: 0, r: '11'.repeat(32), s: '22'.repeat(32) }))
  mocks.trezorSign.mockReset().mockResolvedValue(Ok({ signature: 'synthetic-trezor-signature' }))
  mocks.completeMessage.mockReset().mockResolvedValue(undefined)
  mocks.completeChallenge.mockReset().mockResolvedValue(undefined)
  mocks.refetch.mockReset().mockResolvedValue(undefined)
  mocks.invalidateClaim.mockReset().mockResolvedValue(undefined)
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  queryClient.clear()
  container.remove()
  vi.unstubAllGlobals()
})

afterAll(() => mocks.domGlobals.window.close())

describe('Ledger multisig signing screen', () => {
  beforeEach(render)

  it('advances through the real signing screens and submits the Ledger signature', async () => {
    expect(container.textContent).not.toContain('Unknown error')
    await reachSigning()
    expect(mocks.ledger.init).toHaveBeenCalledTimes(1)
    await clickSign()
    expect(mocks.ledger.signMessage).toHaveBeenCalledWith(
      "m/48'/0'/0'/2'/0/0",
      'Synthetic multisig ownership challenge',
    )
    expect(mocks.completeMessage).toHaveBeenCalledWith({
      signedMessageId: 'message-1',
      signature: Buffer.from([31, ...Array(32).fill(0x11), ...Array(32).fill(0x22)]).toString('base64'),
    })
    expect(mocks.completeChallenge).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith('/multisig/verify/receipt/claim-1/ledger-key')
  })

  it('shows a real initialization failure and does not advance to signing', async () => {
    mocks.ledger.init.mockRejectedValue(new Error('Ledger disconnected'))
    await clickNext()
    await waitForText('Ledger disconnected')
    await clickNext()
    expect(container.textContent).not.toContain('Proving Control With Your Ledger')
    expect(mocks.ledger.signMessage).not.toHaveBeenCalled()
    expect(mocks.completeMessage).not.toHaveBeenCalled()
  })

  it('shows a rejected device signature without submitting or completing the challenge', async () => {
    mocks.ledger.signMessage.mockResolvedValue(Err(new HardwareDeviceError('Rejected', 'ledger', 'Signing canceled')))
    await reachSigning()
    await clickSign()
    await waitForText('Signing canceled')
    expect(container.textContent).not.toContain('Waiting for device confirmation')
    expect(mocks.completeMessage).not.toHaveBeenCalled()
    expect(mocks.completeChallenge).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})

describe.each(['ledger', 'trezor'] as const)('%s as the final multisig cosigner', (walletType) => {
  beforeEach(async () => {
    mocks.walletType = walletType
    const challenge = mocks.claim.latestChallenge!
    challenge.messages.push({
      ...challenge.messages[0]!,
      keystoreId: mocks.claim.keystores[1]!.id,
      signedMessageId: 'message-0' as (typeof challenge.messages)[number]['signedMessageId'],
      signed: true,
    })
    await render()
  })

  it('completes the challenge and navigates to the verified account receipt', async () => {
    await reachSigning()
    await clickSign()
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/accounts/verify/receipt/claim-1'))
    expect(mocks.completeMessage).toHaveBeenCalledTimes(1)
    expect(mocks.completeChallenge).toHaveBeenCalledExactlyOnceWith({ challengeId: 'challenge-1' })
    expect(mocks.invalidateClaim).toHaveBeenCalledWith({ id: 'claim-1' })
    expect(mocks.refetch).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('blocks another signing attempt until the final completion request finishes', async () => {
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
      await act(async () => resolveCompletion())
    }
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/accounts/verify/receipt/claim-1'))
    expect(getSignButton().disabled).toBe(false)
  })

  it('displays final completion failures without navigating to the receipt', async () => {
    mocks.completeChallenge.mockRejectedValueOnce(new Error('Sentinel could not complete verification'))
    await reachSigning()
    await clickSign()
    await waitForText('Sentinel could not complete verification')
    expect(container.textContent).not.toContain('Waiting for device confirmation')
    expect(mocks.completeChallenge).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledWith('There was an error when completing your Multisig claim')
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.invalidateClaim).not.toHaveBeenCalled()
  })
})
