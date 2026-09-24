// @vitest-environment jsdom
import { ChakraProvider, CloseButton, FormControl, FormLabel, Input } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { assert, expect, it } from 'vitest'

it('retains Chakra-generated label associations and close-button names without redundant props', () => {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(
    <ChakraProvider>
      <FormControl>
        <FormLabel>Name</FormLabel>
        <Input />
      </FormControl>
      <CloseButton />
    </ChakraProvider>,
  )
  const label = host.querySelector('label')
  const input = host.querySelector('input')
  assert(label instanceof HTMLLabelElement)
  assert(input instanceof HTMLInputElement)
  expect(input.id).not.toBe('')
  expect(label.htmlFor).toBe(input.id)
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Close')
})
