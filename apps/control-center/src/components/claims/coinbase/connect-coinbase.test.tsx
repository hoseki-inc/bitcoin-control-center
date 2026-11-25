// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { type Operation, TRPCClientError } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { detectCoinbaseKeyKind, trySplitCoinbaseKeyJson } from './coinbase-key-helpers'
import { ConnectCoinbase } from './connect-coinbase'

const edPair = generateKeyPairSync('ed25519')
const edSeed = edPair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16)
const edRawPublic = edPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(12)
const GENERATED_ED25519_SECRET = Buffer.concat([edSeed, edRawPublic]).toString('base64')
const MISMATCHED_ED25519_SECRET = Buffer.concat([edSeed, Buffer.alloc(32, 0x5a)]).toString('base64')
const GENERATED_PKCS8_PEM = edPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

const ecPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const GENERATED_ECDSA_PEM = ecPair.privateKey.export({ format: 'pem', type: 'sec1' }).toString()

function trpcBadRequest(message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: { message, code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } },
  })
}

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

async function mountConnectCoinbase(args?: { handle?: (operation: Operation) => Promise<object | null> }) {
  const dom = browser.acquire()
  Object.defineProperty(dom.window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })

  const requests: Operation[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation)
    if (args?.handle !== undefined) {
      return args.handle(operation)
    }
    return null
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
          <MemoryRouter initialEntries={['/accounts/verify/coinbase']}>
            <Routes>
              <Route path="/accounts/verify/coinbase" element={<ConnectCoinbase />} />
              <Route path="/accounts" element={<p>Accounts list</p>} />
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

  const pasteText = async (element: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<boolean> => {
    let defaultPrevented = false
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (format: string) => (format === 'text' || format === 'text/plain' ? text : ''),
        },
      })
      element.dispatchEvent(event)
      defaultPrevented = event.defaultPrevented
    })
    return defaultPrevented
  }

  const clickButton = async (label: string): Promise<void> => {
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent.trim() === label)
    assert(button !== undefined, `Expected button "${label}"`)
    await act(async () => {
      button.click()
    })
  }

  return {
    container,
    requests,
    fill,
    pasteText,
    clickButton,
    text: () => container.textContent,
  }
}

describe('coinbase-key-helpers', () => {
  it('splits Coinbase JSON blobs with id or name and privateKey', () => {
    expect(trySplitCoinbaseKeyJson(JSON.stringify({ id: 'key-123', privateKey: GENERATED_ED25519_SECRET }))).toEqual({
      apiKey: 'key-123',
      secretKey: GENERATED_ED25519_SECRET,
    })

    expect(
      trySplitCoinbaseKeyJson(
        JSON.stringify({ name: 'organizations/org-1/apiKeys/key-2', privateKey: GENERATED_ECDSA_PEM }),
      ),
    ).toEqual({
      apiKey: 'organizations/org-1/apiKeys/key-2',
      secretKey: GENERATED_ECDSA_PEM,
    })

    expect(trySplitCoinbaseKeyJson('not-json')).toBeNull()
    expect(trySplitCoinbaseKeyJson('{"privateKey":"only-secret"}')).toBeNull()
  })

  it('detects Ed25519, ECDSA, PKCS#8 PEM, and broken PEM keys', () => {
    expect(detectCoinbaseKeyKind(GENERATED_ED25519_SECRET)).toBe('ed25519')
    expect(detectCoinbaseKeyKind(`"${GENERATED_ED25519_SECRET}",`)).toBe('ed25519')
    expect(detectCoinbaseKeyKind(`${GENERATED_ED25519_SECRET}"`)).toBe('ed25519')
    expect(detectCoinbaseKeyKind(`${GENERATED_ED25519_SECRET}",`)).toBe('ed25519')
    expect(detectCoinbaseKeyKind(`"${GENERATED_ED25519_SECRET}`)).toBe('ed25519')
    expect(detectCoinbaseKeyKind(`${GENERATED_ED25519_SECRET}\u201d`)).toBe('ed25519')

    expect(detectCoinbaseKeyKind(GENERATED_ECDSA_PEM)).toBe('ecdsa')
    expect(detectCoinbaseKeyKind(`${GENERATED_ECDSA_PEM.replaceAll('\n', '\\n')}"`)).toBe('ecdsa')
    expect(detectCoinbaseKeyKind(`${JSON.stringify(GENERATED_ECDSA_PEM).slice(1)},`)).toBe('ecdsa')
    expect(detectCoinbaseKeyKind(`"${GENERATED_ECDSA_PEM.replaceAll('\n', '\\n')}`)).toBe('ecdsa')

    expect(detectCoinbaseKeyKind(GENERATED_PKCS8_PEM)).toBe('pem')
    expect(detectCoinbaseKeyKind(`${GENERATED_PKCS8_PEM.replaceAll('\n', '\\n')}"`)).toBe('pem')
    expect(detectCoinbaseKeyKind(`${JSON.stringify(GENERATED_PKCS8_PEM).slice(1)},`)).toBe('pem')

    expect(detectCoinbaseKeyKind('-----BEGIN EC PRIVATE KEY-----\ntruncated')).toBe('invalid')
    expect(detectCoinbaseKeyKind('-----BEGIN EC PRIVATE KEY-----\n   \n-----END EC PRIVATE KEY-----')).toBe('invalid')
    expect(detectCoinbaseKeyKind('legacy-hmac-secret')).toBeNull()
    expect(detectCoinbaseKeyKind('legacy-hmac-secret"')).toBeNull()
    expect(detectCoinbaseKeyKind('')).toBeNull()
  })
})

describe('ConnectCoinbase', () => {
  it('walks through the 3-step guided flow with updated Coinbase copy, hardened inputs, and no Paste buttons', async () => {
    const view = await mountConnectCoinbase()

    expect(view.text()).toContain('Open Coinbase API Keys')
    expect(view.text()).toContain('Create secret API key')
    expect(view.text()).not.toContain('PEM format')
    expect(view.text()).not.toContain('ECDSA (Legacy SDKs)')

    const portalLink = view.container.querySelector<HTMLAnchorElement>('a[href="https://portal.cdp.coinbase.com"]')
    assert.exists(portalLink)

    await view.clickButton('Next')
    expect(view.text()).toContain('Match these key settings')
    expect(view.text()).toContain('Allow requests from any IP address')
    expect(view.text()).toContain('Coinbase App & Advanced Trade')
    expect(view.text()).toContain('Portfolio')
    expect(view.text()).toContain('Primary')
    expect(view.text()).toContain('(or the portfolio you want to track)')
    expect(view.text()).toContain('Read')
    expect(view.text()).toContain('Trade')
    expect(view.text()).toContain('Transfer')
    expect(view.text()).toContain('Receive')
    expect(view.text()).not.toContain('PEM format')
    expect(view.text()).not.toContain('ECDSA (Legacy SDKs)')

    await view.clickButton('I have my key')
    expect(view.text()).toContain('Paste your Coinbase API key')
    expect(view.text()).toContain('Control Center supports both Ed25519 and ECDSA keys.')
    expect(view.text()).toContain('API Key ID')
    expect(view.text()).toContain('API Key Secret')
    expect(view.text()).not.toContain('PEM format')
    expect(view.text()).not.toContain('ECDSA (Legacy SDKs)')

    const pasteButtons = Array.from(view.container.querySelectorAll('button')).filter(
      (button) => button.textContent.trim() === 'Paste',
    )
    expect(pasteButtons).toHaveLength(0)

    const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
    const secretInput = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
    assert.exists(apiKeyInput)
    assert.exists(secretInput)

    expect(apiKeyInput.getAttribute('autocomplete')).toBe('off')
    expect(apiKeyInput.getAttribute('autocorrect')).toBe('off')
    expect(apiKeyInput.getAttribute('autocapitalize')).toBe('off')
    expect(apiKeyInput.getAttribute('spellcheck')).toBe('false')

    expect(secretInput.getAttribute('autocomplete')).toBe('off')
    expect(secretInput.getAttribute('autocorrect')).toBe('off')
    expect(secretInput.getAttribute('autocapitalize')).toBe('off')
    expect(secretInput.getAttribute('spellcheck')).toBe('false')
  })

  it('shows required-field validation errors before sending a request', async () => {
    const view = await mountConnectCoinbase()

    await view.clickButton('Next')
    await view.clickButton('I have my key')
    await view.clickButton('Connect Account')

    await vi.waitFor(() => {
      expect(view.text()).toContain('API Key ID is required')
      expect(view.text()).toContain('API Key Secret is required')
    })
    expect(view.requests).toHaveLength(0)
  })

  it('detects key types, splits pasted JSON into both fields, and warns on broken PEM', async () => {
    const view = await mountConnectCoinbase()

    await view.clickButton('Next')
    await view.clickButton('I have my key')

    const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
    const secretInput = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
    assert.exists(apiKeyInput)
    assert.exists(secretInput)

    await view.fill(secretInput, GENERATED_ED25519_SECRET)
    await vi.waitFor(() => {
      expect(view.text()).toContain('Ed25519 key detected')
    })

    await view.fill(secretInput, GENERATED_ECDSA_PEM)
    await vi.waitFor(() => {
      expect(view.text()).toContain('ECDSA key detected')
    })

    await view.fill(secretInput, '-----BEGIN EC PRIVATE KEY-----\ntruncated')
    await vi.waitFor(() => {
      expect(view.text()).toContain('This is not a valid API Key Secret. Copy it from Coinbase and paste it again.')
    })

    await view.fill(apiKeyInput, JSON.stringify({ id: 'json-key-id', privateKey: GENERATED_ED25519_SECRET }))
    await vi.waitFor(() => {
      expect(apiKeyInput.value).toBe('json-key-id')
      expect(secretInput.value).toBe(GENERATED_ED25519_SECRET)
      expect(view.text()).toContain('Both fields filled from JSON')
      expect(view.text()).toContain('Ed25519 key detected')
    })
  })

  it('replaces both fields on clipboard JSON paste into an already-occupied apiKey field during retry', async () => {
    const view = await mountConnectCoinbase({
      handle: async (op) => {
        if (op.path === 'portalProve.exchanges.coinbase.connect') {
          throw trpcBadRequest(
            'Invalid Coinbase API credentials. Check your API Key ID, Read permission, and IP settings in Coinbase.',
          )
        }
        return null
      },
    })

    await view.clickButton('Next')
    await view.clickButton('I have my key')

    const initialApiKey = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
    const initialSecret = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
    assert.exists(initialApiKey)
    assert.exists(initialSecret)

    await view.fill(initialApiKey, 'stale-key-id')
    await view.fill(initialSecret, GENERATED_ECDSA_PEM)
    await view.clickButton('Connect Account')

    await vi.waitFor(() => {
      expect(view.text()).toContain('Invalid Coinbase API credentials.')
    })

    const retryApiKey = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
    const retrySecret = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
    assert.exists(retryApiKey)
    assert.exists(retrySecret)
    expect(retryApiKey.value).toBe('stale-key-id')
    expect(view.text()).toContain('ECDSA key detected')

    const prevented = await view.pasteText(
      retryApiKey,
      JSON.stringify({ id: 'fresh-retry-key', privateKey: GENERATED_ED25519_SECRET }),
    )
    expect(prevented).toBe(true)

    await vi.waitFor(() => {
      expect(retryApiKey.value).toBe('fresh-retry-key')
      expect(retrySecret.value).toBe(GENERATED_ED25519_SECRET)
      expect(view.text()).toContain('Both fields filled from JSON')
      expect(view.text()).toContain('Ed25519 key detected')
    })
  })

  it('hides the green detection pill on Sentinel format rejection and restores it after editing to a valid key', async () => {
    const view = await mountConnectCoinbase({
      handle: async (op) => {
        if (op.path === 'portalProve.exchanges.coinbase.connect') {
          throw trpcBadRequest('This is not a valid API Key Secret. Copy it from Coinbase and paste it again.')
        }
        return null
      },
    })

    await view.clickButton('Next')
    await view.clickButton('I have my key')

    const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
    const secretInput = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
    assert.exists(apiKeyInput)
    assert.exists(secretInput)

    await view.fill(apiKeyInput, 'cdp-key-id')
    await view.fill(secretInput, MISMATCHED_ED25519_SECRET)
    await vi.waitFor(() => {
      expect(view.text()).toContain('Ed25519 key detected')
    })

    await view.clickButton('Connect Account')

    await vi.waitFor(() => {
      expect(view.text()).toContain('This is not a valid API Key Secret. Copy it from Coinbase and paste it again.')
    })
    expect(view.text()).not.toContain('Ed25519 key detected')
    expect(view.text()).not.toContain('ECDSA key detected')
    expect(view.text()).not.toContain('PEM key detected')

    const retrySecret = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
    assert.exists(retrySecret)
    await view.fill(retrySecret, GENERATED_ED25519_SECRET)

    await vi.waitFor(() => {
      expect(view.text()).toContain('Ed25519 key detected')
    })
  })

  it('submits Ed25519 credentials and shows Coinbase Connected!', async () => {
    const view = await mountConnectCoinbase({
      handle: async (op) => {
        if (op.path === 'portalProve.exchanges.coinbase.connect') {
          return {
            id: 'cb-ed25519',
            exchange: 'coinbase',
            displayName: 'Coinbase',
            balanceSats: '125000000',
            balanceAsOf: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            connectionStatus: 'connected',
          }
        }
        return null
      },
    })

    await view.clickButton('Next')
    await view.clickButton('I have my key')

    const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
    const secretInput = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
    assert.exists(apiKeyInput)
    assert.exists(secretInput)

    await view.fill(apiKeyInput, 'cdp-key-id')
    await view.fill(secretInput, GENERATED_ED25519_SECRET)
    await view.clickButton('Connect Account')

    await vi.waitFor(() => {
      expect(view.text()).toContain('Coinbase Connected!')
    })

    const connectCalls = view.requests.filter((r) => r.path === 'portalProve.exchanges.coinbase.connect')
    expect(connectCalls).toHaveLength(1)
    expect(connectCalls[0]?.input).toEqual({
      apiKey: 'cdp-key-id',
      secretKey: GENERATED_ED25519_SECRET,
      replaceAccountId: undefined,
    })
  })

  it.each([
    {
      label: 'SEC1 ECDSA PEM with trailing quote',
      secret: `${GENERATED_ECDSA_PEM.replaceAll('\n', '\\n')}"`,
      expectedBadge: 'ECDSA key detected',
    },
    {
      label: 'SEC1 ECDSA PEM with trailing quote and comma',
      secret: `${JSON.stringify(GENERATED_ECDSA_PEM).slice(1)},`,
      expectedBadge: 'ECDSA key detected',
    },
    {
      label: 'PKCS#8 PEM with trailing quote',
      secret: `${GENERATED_PKCS8_PEM.replaceAll('\n', '\\n')}"`,
      expectedBadge: 'PEM key detected',
    },
    {
      label: 'PKCS#8 PEM with trailing quote and comma',
      secret: `${JSON.stringify(GENERATED_PKCS8_PEM).slice(1)},`,
      expectedBadge: 'PEM key detected',
    },
  ])('shows $expectedBadge with no invalid warning and submits for $label', async ({ secret, expectedBadge }) => {
    const view = await mountConnectCoinbase({
      handle: async (op) => {
        if (op.path === 'portalProve.exchanges.coinbase.connect') {
          return {
            id: 'cb-pem-trailing',
            exchange: 'coinbase',
            displayName: 'Coinbase',
            balanceSats: '90000000',
            balanceAsOf: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            connectionStatus: 'connected',
          }
        }
        return null
      },
    })

    await view.clickButton('Next')
    await view.clickButton('I have my key')

    const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
    const secretInput = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
    assert.exists(apiKeyInput)
    assert.exists(secretInput)

    await view.fill(apiKeyInput, 'organizations/org-1/apiKeys/key-pem')
    await view.fill(secretInput, secret)

    await vi.waitFor(() => {
      expect(view.text()).toContain(expectedBadge)
    })
    expect(view.text()).not.toContain('This is not a valid API Key Secret. Copy it from Coinbase and paste it again.')
    expect(secretInput.getAttribute('aria-invalid')).not.toBe('true')

    await view.clickButton('Connect Account')
    await vi.waitFor(() => {
      expect(view.text()).toContain('Coinbase Connected!')
    })

    const connectCalls = view.requests.filter((r) => r.path === 'portalProve.exchanges.coinbase.connect')
    expect(connectCalls).toHaveLength(1)
    expect(connectCalls[0]?.input).toEqual({
      apiKey: 'organizations/org-1/apiKeys/key-pem',
      secretKey: secret,
      replaceAccountId: undefined,
    })
  })
})
