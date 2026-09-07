// @vitest-environment jsdom
import { Fragment, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { usePrivacy } from '../hooks/use-privacy'
import { SensitiveValue } from './sensitive-value'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

function Example(): JSX.Element {
  const { hidden, toggle } = usePrivacy()
  return createElement(
    Fragment,
    null,
    createElement('button', { onClick: toggle, 'aria-pressed': hidden }, 'Toggle'),
    createElement(SensitiveValue, { children: createElement('span', { title: '12345' }, '12345') }),
    createElement(SensitiveValue, { children: '$67890' }),
  )
}

afterEach(() => localStorage.clear())

it('replaces sensitive content across consumers, persists on remount, and restores values', async () => {
  const container = document.createElement('div')
  let root = createRoot(container)
  await act(async () => root.render(createElement(Example)))
  expect(container.textContent).toContain('12345')
  await act(async () => container.querySelector('button')?.click())
  expect(container.textContent).not.toContain('12345')
  expect(container.textContent).not.toContain('67890')
  expect(container.querySelector('[title="12345"]')).toBeNull()
  expect(container.textContent).toBe('Toggle********')
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('true')
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(createElement(Example)))
  expect(container.textContent).toBe('Toggle********')
  await act(async () => container.querySelector('button')?.click())
  expect(container.textContent).toContain('12345')
  expect(container.textContent).toContain('$67890')
  await act(async () => root.unmount())
})

it('responds to a privacy preference changed in another tab', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(createElement(Example)))
  await act(async () => {
    localStorage.setItem('control-center:privacy', 'true')
    window.dispatchEvent(new StorageEvent('storage', { key: 'control-center:privacy' }))
  })
  expect(container.textContent).toBe('Toggle********')
  await act(async () => root.unmount())
})
