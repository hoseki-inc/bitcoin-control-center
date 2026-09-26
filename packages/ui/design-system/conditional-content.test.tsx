// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SectionTitle } from '../prove-verify-ui/section-title'
import { Alert } from './alert'
import { ErrorInline } from './errors'

function render(content: ReactNode): HTMLDivElement {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<ChakraProvider>{content}</ChakraProvider>)
  host.querySelectorAll('style').forEach((style) => {
    style.remove()
  })
  return host
}

const cases: { name: string; value: ReactNode; text: string; stackText?: string; wrapped: boolean }[] = [
  { name: 'zero', value: 0, text: '0', stackText: '', wrapped: false },
  { name: 'empty text', value: '', text: '', wrapped: false },
  { name: 'false', value: false, text: '', wrapped: false },
  { name: 'null', value: null, text: '', wrapped: false },
  { name: 'undefined', value: undefined, text: '', wrapped: false },
  { name: 'nonempty text', value: 'Detail', text: 'Detail', wrapped: true },
  { name: 'empty array', value: [], text: '', wrapped: true },
  { name: 'element containing zero', value: <span>0</span>, text: '0', wrapped: true },
]

describe.each(cases)('conditional content: $name', ({ value, text, stackText = text, wrapped }) => {
  it('preserves alert title and description rendering', () => {
    const host = render(<Alert title={value}>{value}</Alert>)
    expect(host.textContent).toBe(stackText + stackText)
    expect(host.querySelector('.chakra-alert__title') !== null).toBe(wrapped)
    expect(host.querySelector('.chakra-alert__desc') !== null).toBe(wrapped)
  })

  it('preserves section description rendering', () => {
    const host = render(<SectionTitle title="Heading" description={value} />)
    expect(host.textContent).toBe('Heading' + text)
    expect(host.querySelector('p') !== null).toBe(wrapped)
  })

  it('preserves inline error content rendering', () => {
    const host = render(<ErrorInline title="Heading" message="Message" otherContent={value} data-testid="inline" />)
    expect(host.textContent).toBe('HeadingMessage' + stackText)
    const inline = host.querySelector('[data-testid="inline"]')
    expect(inline?.children.length).toBe(wrapped ? 3 : 2)
  })
})
