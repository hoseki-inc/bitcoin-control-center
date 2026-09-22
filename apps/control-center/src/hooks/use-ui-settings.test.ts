// @vitest-environment jsdom
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUiSettings } from './use-ui-settings'

let root: Root
let container: HTMLDivElement
const storageKey = 'ui::settings::local'

function Preferences(): React.ReactElement {
  const { isStatementsMadeEasyDismissed, updateUiSettings } = useUiSettings()
  return createElement(
    'button',
    {
      onClick: () => {
        updateUiSettings({ isStatementsMadeEasyDismissed: true })
      },
    },
    String(isStatementsMadeEasyDismissed),
  )
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  [null, false],
  ['{"isStatementsMadeEasyDismissed":true}', true],
  ['{"isStatementsMadeEasyDismissed":false}', false],
  ['{"isStatementsMadeEasyDismissed":"false"}', false],
  ['{"isStatementsMadeEasyDismissed":1}', false],
  ['{}', false],
  ['null', false],
  ['[]', false],
  ['broken JSON', false],
])('loads saved preferences safely from %s', async (stored, expected) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  if (stored !== null) {
    localStorage.setItem(storageKey, stored)
  }
  await act(async () => {
    root.render(createElement(Preferences))
  })
  expect(container.textContent).toBe(String(expected))
  expect(localStorage.getItem(storageKey)).toBe(stored)
})

it('persists preference updates after falling back from invalid saved data', async () => {
  localStorage.setItem(storageKey, 'null')
  await act(async () => {
    root.render(createElement(Preferences))
  })
  const button = container.querySelector('button')
  if (!button) {
    throw new Error('Missing preference button')
  }
  await act(async () => {
    button.click()
  })
  expect(container.textContent).toBe('true')
  expect(localStorage.getItem(storageKey)).toBe('{"isStatementsMadeEasyDismissed":true}')
})
