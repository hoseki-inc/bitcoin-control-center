// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { expectElement } from '@hoseki/packages/testing/dom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AccountSummary } from '../../hooks/use-accounts'
import { CommandPalette } from './command-palette'
import type { Command } from './commands'

const mocks = vi.hoisted(() => ({ runs: [] as string[] }))

vi.mock('./orb', () => ({ Orb: () => <div data-testid="orb" /> }))
vi.mock('../account-grid', () => ({ AccountArtwork: () => <span /> }))
vi.mock('./commands', () => {
  const command = (id: string, group: Command['group'], label: string, extra: Partial<Command> = {}): Command => ({
    id,
    group,
    label,
    icon: <span />,
    run: () => {
      mocks.runs.push(id)
    },
    ...extra,
  })
  const account: AccountSummary = {
    id: 'a',
    kind: 'wallet',
    name: 'Cold Wallet',
    to: '/accounts/a',
    sats: 1,
    state: 'verified',
    wallet: 'trezor',
    exchange: null,
    quorum: null,
  }
  return {
    useCommands: () => ({
      accounts: [account],
      commands: [
        command('go-portfolio', 'Go to', 'Portfolio'),
        command('go-statements', 'Go to', 'Statements', { keywords: ['pdf'] }),
        command('account-wallet-a', 'Accounts', 'Cold Wallet', { searchOnly: true, detail: 'Self-custody wallet' }),
        command('privacy', 'Actions', 'Hide balances'),
        command('settings-display', 'Settings', 'Bitcoin display', { searchOnly: true, keywords: ['sats'] }),
      ],
    }),
  }
})

describe('CommandPalette', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const onClose = vi.fn<() => void>()

  async function withTestSetup(run: () => Promise<void>): Promise<void> {
    // Vitest owns teardown, so it runs once even after a failure or timeout.
    onTestFinished(async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    })

    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    // jsdom has neither; the palette only needs them to exist.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
        public unobserve(): void {}
      },
    )
    Element.prototype.scrollIntoView = vi.fn<() => void>()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    mocks.runs = []
    onClose.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await run()
  }

  const render = async (): Promise<void> => {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <CommandPalette open onClose={onClose} />
        </ChakraProvider>,
      )
    })
  }
  const input = (): HTMLInputElement =>
    expectElement(container.querySelector('input[role="combobox"]'), HTMLInputElement)
  const options = (): string[] => [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)
  const selected = (): string | null =>
    container.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? null
  const type = async (value: string): Promise<void> => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    assert(descriptor?.set !== undefined, 'Expected the input value setter')
    descriptor.set.call(input(), value)
    await act(async () => {
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const press = async (key: string): Promise<void> => {
    await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  }

  it('opens focused, with suggestions and account shortcuts', async () => {
    await withTestSetup(async () => {
      await render()
      expect(container.querySelector('dialog[aria-label="Search"]')).not.toBeNull()
      expect(document.activeElement).toBe(input())
      expect(options()).toEqual(['Portfolio', 'Statements', 'Hide balances'])
      expect(container.textContent).toContain('Cold Wallet')
      expect(selected()).toBe('Portfolio')
    })
  })

  it('filters as you type, including accounts, settings and keywords', async () => {
    await withTestSetup(async () => {
      await render()
      await type('cold')
      expect(options()).toEqual(['Cold Wallet Self-custody wallet'])
      await type('sats')
      // The keyword hit ranks first; looser in-order letter matches may follow it.
      expect(options()[0]).toBe('Bitcoin display')
      expect(selected()).toBe('Bitcoin display')
      await type('zzz')
      expect(container.textContent).toContain('No matches for “zzz”')
    })
  })

  it('moves with the arrow keys and runs the selection on Enter', async () => {
    await withTestSetup(async () => {
      await render()
      await press('ArrowDown')
      expect(selected()).toBe('Statements')
      await press('ArrowUp')
      await press('ArrowUp')
      expect(selected()).toBe('Hide balances')
      await press('Enter')
      expect(onClose).toHaveBeenCalledOnce()
      expect(mocks.runs).toEqual(['privacy'])
    })
  })

  it('clears the query on the first Escape and closes on the second', async () => {
    await withTestSetup(async () => {
      await render()
      await type('port')
      await press('Escape')
      expect(input().value).toBe('')
      expect(onClose).not.toHaveBeenCalled()
      await press('Escape')
      expect(onClose).toHaveBeenCalledOnce()
    })
  })
})
