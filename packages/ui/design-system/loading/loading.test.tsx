// @vitest-environment jsdom
import { Box, ChakraProvider } from '@chakra-ui/react'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SkeletonRegion, TextSkeleton, useRevealAfterLoading } from './loading'
import { useDelayedFlag } from './use-delayed-flag'

let root: Root
let host: HTMLDivElement

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await run()
}

async function render(content: JSX.Element): Promise<void> {
  await act(async () => {
    root.render(<ChakraProvider>{content}</ChakraProvider>)
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

function DelayedFlag({ active }: { active: boolean }): JSX.Element {
  return <output>{String(useDelayedFlag(active))}</output>
}

it('turns on only after staying active for the delay, and off at once', async () => {
  await withTestSetup(async () => {
    await render(<DelayedFlag active />)
    expect(host.textContent).toBe('false')
    await advance(299)
    expect(host.textContent).toBe('false')
    await advance(1)
    expect(host.textContent).toBe('true')
    await render(<DelayedFlag active={false} />)
    expect(host.textContent).toBe('false')
    // A quick load never turns it on.
    await render(<DelayedFlag active />)
    await advance(200)
    await render(<DelayedFlag active={false} />)
    await advance(500)
    expect(host.textContent).toBe('false')
  })
})

it('marks a skeleton region busy, names it for screen readers, and shows it only after the delay', async () => {
  await withTestSetup(async () => {
    await render(
      <SkeletonRegion label="Loading accounts" data-testid="region">
        <Box h="40px" />
      </SkeletonRegion>,
    )
    const region = host.querySelector('[data-testid="region"]')
    expect(region?.getAttribute('aria-busy')).toBe('true')
    expect(region?.textContent).toBe('Loading accounts')
    const placeholder = region?.querySelector('[aria-hidden="true"]')
    expect(placeholder && getComputedStyle(placeholder).opacity).toBe('0')
    await advance(300)
    expect(placeholder && getComputedStyle(placeholder).opacity).toBe('1')
  })
})

it('keeps a text skeleton out of the accessibility tree and invisible until the delay passes', async () => {
  await withTestSetup(async () => {
    await render(<TextSkeleton data-testid="text" />)
    const skeleton = host.querySelector('[data-testid="text"]')
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true')
    expect(skeleton && getComputedStyle(skeleton).opacity).toBe('0')
    await advance(300)
    expect(skeleton && getComputedStyle(skeleton).opacity).toBe('1')
  })
})

function Revealed({ loading }: { loading: boolean }): JSX.Element {
  return <output>{useRevealAfterLoading(loading) === undefined ? 'plain' : 'reveal'}</output>
}

it('fades content in only when it replaces a skeleton that was shown', async () => {
  await withTestSetup(async () => {
    await render(<Revealed loading />)
    await advance(100)
    await render(<Revealed loading={false} />)
    expect(host.textContent).toBe('plain')

    await render(<Revealed loading />)
    expect(host.textContent).toBe('plain')
    await advance(300)
    await render(<Revealed loading={false} />)
    expect(host.textContent).toBe('reveal')
  })
})
