// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest'
import { Spinner } from './spinner'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function render(isLazy: boolean): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <Spinner isLazy={isLazy} data-testid="spinner" />
      </ChakraProvider>,
    )
  })
}

function visibility(): string {
  const spinner = host.querySelector('[data-testid="spinner"]')
  assert(spinner instanceof HTMLElement)
  return getComputedStyle(spinner).visibility
}

it('waits 200ms before showing a lazy spinner', async () => {
  await render(true)
  expect(visibility()).toBe('hidden')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(199)
  })
  expect(visibility()).toBe('hidden')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(visibility()).toBe('visible')
})

it('shows immediately and cancels the delay when laziness is disabled', async () => {
  await render(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50)
  })
  await render(false)
  expect(visibility()).toBe('visible')
  expect(vi.getTimerCount()).toBe(0)
})

it('clears the pending delay when the spinner is removed', async () => {
  await render(true)
  await act(async () => {
    root.render(null)
  })
  expect(vi.getTimerCount()).toBe(0)
})
