// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { FullTransitionModal, getContent } from './full-transition-modal'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('@hoseki/packages/ui/design-system', () => ({ Spinner: () => createElement('span', null, 'Preparing') }))

it('shows completion and failure immediately, without waiting for an animation', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onClose = vi.fn()
  const render = async (status: 'pending' | 'completed' | 'failed'): Promise<void> => {
    await act(async () =>
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(FullTransitionModal, {
            isOpen: true,
            onClose,
            status,
            content: getContent(),
            additionalCompletedContent: createElement('button', null, 'View Statement'),
          }),
        ),
      ),
    )
  }
  try {
    await render('pending')
    expect(document.body.textContent).toContain('Continue in background')
    await render('completed')
    expect(document.body.textContent).toContain('Statement ready')
    expect(document.body.textContent).toContain('View Statement')
    expect(document.body.textContent).not.toContain('Continue in background')
    await render('failed')
    expect(document.body.textContent).toContain('Statement not created')
    const back = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Back to statement')
    await act(async () => back?.click())
    expect(onClose).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
