// @vitest-environment jsdom
import { ChakraProvider, FormControl, FormLabel } from '@chakra-ui/react'
import { DateInput } from '@hoseki/packages/ui/design-system/forms/date-input'
import { DateStringInput } from '@hoseki/packages/ui/design-system/forms/date-string-input'
import { type ReactElement, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'

let root: Root
let container: HTMLDivElement

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }),
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

async function render(element: ReactElement): Promise<void> {
  await act(async () => {
    root.render(createElement(ChakraProvider, null, element))
  })
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
  })
}

function calendarTrigger(): HTMLButtonElement {
  const button = container.querySelector('button')
  assert.exists(button, 'Expected the calendar trigger')
  return button
}

function day(number: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.rdp-day_button')).find(
    (candidate) => candidate.textContent === number,
  )
  assert.exists(button, `Expected calendar day ${number}`)
  return button
}

it('selects local calendar dates and excludes dates outside the supplied bounds', async () => {
  await withTestSetup(async () => {
    const onChange = vi.fn<(date: Date | null) => void>()
    await render(
      createElement(DateInput, {
        value: new Date(2026, 8, 7),
        min: new Date(2026, 8, 5),
        max: new Date(2026, 8, 20),
        onChange,
      }),
    )
    await click(calendarTrigger())
    expect(day('4').disabled).toBe(true)
    expect(day('21').disabled).toBe(true)
    await click(day('15'))
    const date = onChange.mock.lastCall?.[0]
    assert(date instanceof Date, 'Expected a selected date')
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 8, 15, 0])
  })
})

it('inherits disabled and required state from its form control', async () => {
  await withTestSetup(async () => {
    await render(
      createElement(
        FormControl,
        { isDisabled: true, isRequired: true },
        createElement(FormLabel, null, 'As of date'),
        createElement(DateStringInput, { value: '2026-09-07', onChange: vi.fn<(value: string) => void>() }),
      ),
    )
    expect(container.querySelector('button')?.disabled).toBe(true)
    expect(container.querySelector('input')?.required).toBe(true)
  })
})

it('does not clear a required date when clicking its selected day', async () => {
  await withTestSetup(async () => {
    const onChange = vi.fn<(value: string) => void>()
    await render(createElement(DateStringInput, { value: '2026-09-07', onChange, isRequired: true }))
    await click(calendarTrigger())
    expect(Array.from(document.querySelectorAll('button')).some((button) => button.textContent === 'Clear')).toBe(false)
    const selected = document.querySelector('.rdp-selected button')
    assert(selected instanceof HTMLButtonElement, 'Expected the selected day')
    await click(selected)
    expect(onChange).not.toHaveBeenCalledWith('')
  })
})

it('jumps directly to 2009 without selecting a date and prevents earlier dates', async () => {
  await withTestSetup(async () => {
    const onChange = vi.fn<(value: string) => void>()
    await render(createElement(DateStringInput, { value: '2026-03-06', onChange }))
    await click(calendarTrigger())
    const years = container.querySelector('.rdp-years_dropdown')
    assert(years instanceof HTMLSelectElement, 'Expected the year dropdown')
    expect(years.options[0]?.value).toBe('2009')
    await act(async () => {
      years.value = '2009'
      years.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(years.value).toBe('2009')
    expect(onChange).not.toHaveBeenCalled()
    await click(day('15'))
    expect(onChange).toHaveBeenLastCalledWith('2009-03-15')
  })
})
