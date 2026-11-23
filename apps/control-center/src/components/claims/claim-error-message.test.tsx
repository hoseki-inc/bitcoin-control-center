// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { TRPCClientError } from '@trpc/client'
import { type ComponentProps, act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { describe, expect, expectTypeOf, it, onTestFinished, vi } from 'vitest'
import { ClaimErrorMessage } from './claim-error-message'

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

async function renderClaimError(props: ComponentProps<typeof ClaimErrorMessage>) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    dom.window.close()
  })

  await act(async () => {
    root.render(
      <TestChakraProvider>
        <MemoryRouter>
          <ClaimErrorMessage {...props} />
        </MemoryRouter>
      </TestChakraProvider>,
    )
  })

  return container
}

describe('ClaimErrorMessage', () => {
  it('renders an Error message instead of the generic fallback', async () => {
    const message =
      "Couldn't check balances with Electrum. Your wallet wasn't scanned. Check your Electrum connection and try again."
    const container = await renderClaimError({ error: new Error(message) })

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain(message)
    expect(alert?.textContent).not.toContain('An unexpected error occurred')
  })

  it('renders the message from a TRPCClientError', async () => {
    const trpcError = TRPCClientError.from({
      error: {
        message:
          "Couldn't check balances with Electrum. Your wallet wasn't scanned. Check your Electrum connection and try again.",
        code: -32603,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
      },
    })
    const container = await renderClaimError({ error: trpcError })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't check balances with Electrum. Your wallet wasn't scanned. Check your Electrum connection and try again.",
    )
  })

  it('renders the message from a plain message object', async () => {
    const container = await renderClaimError({ error: { message: 'Plain error object message' } })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Plain error object message')
  })

  it('falls back to the generic message when error.message is empty', async () => {
    const container = await renderClaimError({ error: new Error('') })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('An unexpected error occurred')
  })

  it('falls back to the generic message when error.message is only whitespace', async () => {
    const container = await renderClaimError({ error: new Error('   ') })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('An unexpected error occurred')
  })

  it('calls onRetry when clicked and does not render a link to /accounts', async () => {
    const onRetry = vi.fn<() => void>()
    const container = await renderClaimError({ error: new Error('Scan failed'), onRetry })

    const retryButton = container.querySelector('button[type="button"]')
    expect(retryButton?.textContent).toBe('Retry')
    expect(container.querySelector('a[href="/accounts"]')).toBeNull()

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('links Retry to /accounts when onRetry is omitted', async () => {
    const container = await renderClaimError({ error: new Error('Scan failed') })

    const retryLink = container.querySelector('a[href="/accounts"]')
    expect(retryLink?.textContent).toBe('Retry')
    expect(container.querySelector('button[type="button"]')).toBeNull()
  })

  it('rejects string values for the error prop at compile time', () => {
    expectTypeOf<string>().not.toMatchTypeOf<ComponentProps<typeof ClaimErrorMessage>['error']>()

    const check = () => (
      // @ts-expect-error: ClaimErrorMessage error prop must not accept a raw string
      <ClaimErrorMessage error="string error is rejected" />
    )
    expect(check).toBeTypeOf('function')
  })
})
