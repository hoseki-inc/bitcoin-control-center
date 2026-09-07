// @vitest-environment jsdom
import { ChakraProvider, FormControl, FormLabel } from '@chakra-ui/react'
import { DateInput } from '@hoseki/packages/ui/design-system/forms/date-input'
import { DateStringInput } from '@hoseki/packages/ui/design-system/forms/date-string-input'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it('selects local calendar dates and excludes dates outside the supplied bounds', async () => {
  const onChange = vi.fn()
  await act(async () =>
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(DateInput, {
          value: new Date(2026, 8, 7),
          min: new Date(2026, 8, 5),
          max: new Date(2026, 8, 20),
          onChange,
        }),
      ),
    ),
  )
  await act(async () => (container.querySelector('button') as HTMLButtonElement).click())
  const day = (number: string): HTMLButtonElement =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.rdp-day_button')).find(
      (button) => button.textContent === number,
    )!
  expect(day('4').disabled).toBe(true)
  expect(day('21').disabled).toBe(true)
  await act(async () => day('15').click())
  const date = onChange.mock.lastCall?.[0] as Date
  expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 8, 15, 0])
})

it('inherits disabled and required state from its form control', async () => {
  await act(async () =>
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          FormControl,
          { isDisabled: true, isRequired: true },
          createElement(FormLabel, null, 'As of date'),
          createElement(DateStringInput, { value: '2026-09-07', onChange: vi.fn() }),
        ),
      ),
    ),
  )
  expect(container.querySelector('button')?.disabled).toBe(true)
  expect(container.querySelector('input')?.required).toBe(true)
})

it('does not clear a required date when clicking its selected day', async () => {
  const onChange = vi.fn()
  await act(async () =>
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(DateStringInput, { value: '2026-09-07', onChange, isRequired: true }),
      ),
    ),
  )
  await act(async () => (container.querySelector('button') as HTMLButtonElement).click())
  expect(Array.from(document.querySelectorAll('button')).some((button) => button.textContent === 'Clear')).toBe(false)
  const selected = document.querySelector('.rdp-selected button') as HTMLButtonElement
  await act(async () => selected.click())
  expect(onChange).not.toHaveBeenCalledWith('')
})

it('jumps directly to 2009 without selecting a date and prevents earlier dates', async () => {
  const onChange = vi.fn()
  await act(async () =>
    root.render(createElement(ChakraProvider, null, createElement(DateStringInput, { value: '2026-03-06', onChange }))),
  )
  await act(async () => (container.querySelector('button') as HTMLButtonElement).click())
  const years = container.querySelector('.rdp-years_dropdown') as HTMLSelectElement
  expect(years).not.toBeNull()
  expect(years.options[0]?.value).toBe('2009')
  await act(async () => {
    years.value = '2009'
    years.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(years.value).toBe('2009')
  expect(onChange).not.toHaveBeenCalled()
  const day = Array.from(container.querySelectorAll<HTMLButtonElement>('.rdp-day_button')).find(
    (button) => button.textContent === '15',
  )!
  await act(async () => day.click())
  expect(onChange).toHaveBeenLastCalledWith('2009-03-15')
})
