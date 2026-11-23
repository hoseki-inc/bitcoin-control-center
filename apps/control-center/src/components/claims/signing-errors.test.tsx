// @vitest-environment node
import { Address, DerivationPath, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { Slip132 } from '@hoseki/packages/wallet'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { Toaster, toast } from 'sonner'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SigningFlowProps } from '../../lib/claim-flow'
import { TestTrpcProvider, badRequest, createTestTrpcClient, internalError } from '../../testing/trpc'
import type { RouterOutput } from '../../trpc'
import type { ChallengeDto, ChallengeMessageDto, ClaimDto, KeystoreDto } from '../../trpc/server-types'
import { type QrCamera, type QrCameraFactory, QrCameraProvider } from '../qr/bbqr-scanner'
import { ColdcardSigning } from './coldcard/coldcard-signing'
import { KeystoneSigning } from './keystone/keystone-signing'
import { ManualSigning } from './manual-bitcoin/manual-signing'

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

type SinglesigFlow = 'manual' | 'keystone-qr' | 'coldcard-qr' | 'coldcard-file'

const FALLBACK_TITLES: Record<SinglesigFlow, string> = {
  manual: "Couldn't verify this account",
  'keystone-qr': 'The signing process did not complete successfully.',
  'coldcard-qr': 'The signing process did not complete successfully.',
  'coldcard-file': 'The signing process did not complete successfully.',
}

function buildSigningProps(flow: SinglesigFlow): SigningFlowProps {
  const xpub = Slip132.getXpubFromString(
    'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
  ).expect('public test xpub')
  const createdAt = new Date('2026-01-01T00:00:00Z')
  const address = Address.fromString('1BoatSLRHtKNngkdXEeobR76b53LETtpyT').expect('valid test address').toString()
  const model = flow === 'coldcard-qr' ? 'Q' : flow === 'coldcard-file' ? 'MK4' : null
  const wallet = flow === 'keystone-qr' ? 'keystone' : flow === 'manual' ? null : 'coldcard'
  const keystore: KeystoreDto = {
    id: 're_ks_single',
    createdAt,
    updatedAt: createdAt,
    label: 'Primary key',
    xpub,
    wallet,
    model,
    isIdentified: true,
    derivationPath: DerivationPath.fromString('m/84h/0h/0h').expect('valid derivation path').toString(),
  }
  const claim: ClaimDto = {
    id: 're_clmx_single1',
    createdAt,
    updatedAt: createdAt,
    isVerified: false,
    officialName: '',
    displayName: 'Test singlesig',
    network: 'bitcoin_mainnet',
    status: 'pending',
    isArchived: false,
    metadata: null,
    account: new SingleSigAccount('p2wpkh', xpub).descriptor(),
    keystores: [keystore],
    latestChallenge: {
      id: 're_chal_single1',
      completed: false,
      messages: [{ signedMessageId: 're_mesg_single1', keystoreId: keystore.id, signed: false }],
    },
  }
  const challenge: ChallengeDto = {
    id: 're_chal_single1',
    claimId: claim.id,
    variant: 'signed_message',
    isSatisfied: false,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
  }
  const challengeMessage: ChallengeMessageDto = {
    challengeId: 're_chal_single1',
    keystoreId: keystore.id,
    signedMessage: {
      version: 0,
      id: 're_mesg_single1',
      address,
      messageTextToSign: 'Synthetic singlesig ownership challenge',
      createdAt,
      updatedAt: createdAt,
      signedAt: null,
      signature: null,
    },
  }
  return {
    claim,
    keystore,
    challenge,
    challengeMessage,
    onExitSigning: vi.fn<() => void>(),
    onSigningComplete: vi.fn<() => void>(),
  }
}

async function mountSinglesigFlow(
  flow: SinglesigFlow,
  options: {
    completeMessageError?: Error
    completeChallengeError?: Error
  },
) {
  const dom = browser.acquire()
  const imageConstructor: unknown = dom.window['Image']
  vi.stubGlobal('Image', imageConstructor)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })

  const completeMessageCalls = vi.fn<() => void>()
  const completeChallengeCalls = vi.fn<() => void>()
  const props = buildSigningProps(flow)

  const rpc = createTestTrpcClient(async (operation) => {
    switch (operation.path) {
      case 'portalProve.onchain.bitcoinAccountBalances':
        return { accounts: new Map() }
      case 'portalProve.registry.challengeMessages.complete': {
        completeMessageCalls()
        if (options.completeMessageError) {
          throw options.completeMessageError
        }
        return {
          ...props.challengeMessage,
          signedMessage: {
            ...props.challengeMessage.signedMessage,
            signedAt: new Date(),
            signature: 'c3ludGhldGljLXNpZ25hdHVyZQ==',
          },
        } satisfies ChallengeMessageDto
      }
      case 'portalProve.registry.challenges.complete': {
        completeChallengeCalls()
        if (options.completeChallengeError) {
          throw options.completeChallengeError
        }
        return {
          ...props.challenge,
          isSatisfied: true,
          completedAt: new Date(),
        } satisfies RouterOutput['portalProve']['registry']['challenges']['complete']
      }
      default:
        throw new Error(`Unexpected request: ${operation.path}`)
    }
  })

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

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  })
  const toastError = vi.spyOn(toast, 'error')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  onTestFinished(async () => {
    await act(async () => {
      toast.dismiss()
      root.unmount()
    })
    container.remove()
    client.clear()
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
  })

  const element =
    flow === 'manual' ? (
      <ManualSigning {...props} />
    ) : flow === 'keystone-qr' ? (
      <KeystoneSigning {...props} />
    ) : (
      <ColdcardSigning {...props} />
    )

  await act(async () => {
    root.render(
      <TestChakraProvider>
        <TestTrpcProvider client={client} rpc={rpc}>
          <QrCameraProvider value={cameraFactory}>
            <Toaster />
            <MemoryRouter>{element}</MemoryRouter>
          </QrCameraProvider>
        </TestTrpcProvider>
      </TestChakraProvider>,
    )
  })

  const clickButton = async (label: string): Promise<void> => {
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
    assert.exists(button, `Expected button "${label}"`)
    await act(async () => {
      button.click()
    })
  }

  const clickArrowForward = async (): Promise<void> => {
    const button = container.querySelector('svg.lucide-arrow-right')?.closest('button')
    assert.exists(button, 'Expected forward arrow button')
    await act(async () => {
      button.click()
    })
  }

  const waitForText = async (text: string): Promise<void> => {
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0)
        })
      })
      expect(container.textContent).toContain(text)
    })
  }

  const submitSignature = async (): Promise<void> => {
    if (flow === 'manual') {
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea#signature')
      assert.exists(textarea, 'Expected signature textarea')
      await act(async () => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')
        assert(descriptor?.set !== undefined, 'Expected textarea value setter')
        descriptor.set.call(textarea, 'c3ludGhldGljLXNpZ25hdHVyZQ==')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await clickButton('Verify')
      return
    }

    if (flow === 'keystone-qr') {
      await clickArrowForward()
      await clickButton('Next')
      await clickButton('Ready to Scan')
      await waitForText('Point your webcam at the QR code...')
      await act(async () => {
        scanText('c3ludGhldGljLXNpZ25hdHVyZQ==')
      })
      return
    }

    if (flow === 'coldcard-qr') {
      await clickArrowForward()
      await clickArrowForward()
      await clickButton('Next')
      await clickButton('Ready to Scan')
      await waitForText('Point your webcam at the QR code...')
      await act(async () => {
        scanText('c3ludGhldGljLXNpZ25hdHVyZQ==')
      })
      return
    }

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const copy = container.querySelector('svg.lucide-copy')?.closest('button')
    assert.exists(copy, 'Expected copy button')
    await act(async () => {
      copy.click()
    })
    await clickButton('Next')
    await clickButton('Next')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    assert.exists(input, 'Expected signature file input')
    const contents = [
      '-----BEGIN BITCOIN SIGNED MESSAGE-----',
      'Synthetic singlesig ownership challenge',
      '-----BEGIN BITCOIN SIGNATURE-----',
      '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      'c3ludGhldGljLXNpZ25hdHVyZQ==',
      '-----END BITCOIN SIGNATURE-----',
    ].join('\n')
    Object.defineProperty(input, 'files', {
      value: [new dom.window.File([contents], 'signature.txt', { type: 'text/plain' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForText('Prove Control')
    await clickButton('Prove Control')
  }

  return {
    props,
    toastError,
    completeMessageCalls,
    completeChallengeCalls,
    submitSignature,
  }
}

describe.each(['manual', 'keystone-qr', 'coldcard-qr', 'coldcard-file'] as const)(
  '%s single-sig signing errors',
  (flow) => {
    const title = FALLBACK_TITLES[flow]

    it('shows the server reason when challengeMessages.complete rejects with BAD_REQUEST', async () => {
      const harness = await mountSinglesigFlow(flow, {
        completeMessageError: badRequest('Invalid signature'),
      })

      await harness.submitSignature()

      await vi.waitFor(() => {
        expect(harness.toastError).toHaveBeenCalledWith(title, { description: 'Invalid signature' })
      })
      expect(harness.completeMessageCalls).toHaveBeenCalledTimes(1)
      expect(harness.completeChallengeCalls).not.toHaveBeenCalled()
      expect(harness.props.onSigningComplete).not.toHaveBeenCalled()
    })

    it('shows the server reason when challenges.complete rejects with BAD_REQUEST', async () => {
      const harness = await mountSinglesigFlow(flow, {
        completeChallengeError: badRequest('Challenge already completed'),
      })

      await harness.submitSignature()

      await vi.waitFor(() => {
        expect(harness.toastError).toHaveBeenCalledWith(title, { description: 'Challenge already completed' })
      })
      expect(harness.completeMessageCalls).toHaveBeenCalledTimes(1)
      expect(harness.completeChallengeCalls).toHaveBeenCalledTimes(1)
      expect(harness.props.onSigningComplete).not.toHaveBeenCalled()
    })

    it('falls back to the generic title without leaking internal errors', async () => {
      const harness = await mountSinglesigFlow(flow, {
        completeMessageError: internalError('SQLITE_BUSY: database is locked'),
      })

      await harness.submitSignature()

      await vi.waitFor(() => {
        expect(harness.toastError).toHaveBeenCalledWith(title)
      })
      expect(harness.toastError.mock.calls).toEqual([[title]])
      expect(JSON.stringify(harness.toastError.mock.calls)).not.toContain('SQLITE_BUSY')
      expect(document.body.textContent).not.toContain('SQLITE_BUSY')
      expect(harness.props.onSigningComplete).not.toHaveBeenCalled()
    })
  },
)
