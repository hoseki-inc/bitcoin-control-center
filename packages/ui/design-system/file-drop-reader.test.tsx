// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { Err, Ok } from '@hoseki/packages/result'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { FileDropReader } from './file-drop-reader'

let root: Root
let host: HTMLDivElement
const onValidContentRead = vi.fn()
const onInvalidContentRead = vi.fn()
const onStatusChange = vi.fn()
const common = {
  readyText: 'Upload',
  invalidText: 'Invalid',
  validText: 'Valid',
  status: 'ready' as const,
  onValidContentRead,
  onInvalidContentRead,
  onStatusChange,
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  await run()
}

async function selectFile(file: File): Promise<void> {
  const input = host.querySelector('input')
  assert(input instanceof HTMLInputElement)
  Object.defineProperty(input, 'files', { value: [file] })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledTimes(1)
    })
  })
}

it('reads wallet text before validating and forwarding it', async () => {
  await withTestSetup(async () => {
    const validate = vi.fn((text: string) => Ok(text.toUpperCase()))
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FileDropReader {...common} readAs="text" acceptedFileTypes={['json', 'txt']} validationFn={validate} />
        </ChakraProvider>,
      )
    })
    const file = new File(['wallet'], 'wallet.txt', { type: 'text/plain' })
    await selectFile(file)
    expect(validate).toHaveBeenCalledWith('wallet', file)
    expect(onValidContentRead).toHaveBeenCalledWith('WALLET', file)
    expect(onStatusChange).toHaveBeenCalledWith('valid')
    expect(onInvalidContentRead).not.toHaveBeenCalled()
  })
})

it('reads image bytes and retains the jpg/jpeg alias', async () => {
  await withTestSetup(async () => {
    const validate = vi.fn((bytes: ArrayBuffer) => Ok(Array.from(new Uint8Array(bytes))))
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FileDropReader {...common} readAs="arrayBuffer" acceptedFileTypes={['jpg']} validationFn={validate} />
        </ChakraProvider>,
      )
    })
    expect(host.querySelector('input')?.accept).toBe('.jpg,.jpeg')
    const file = new File([new Uint8Array([1, 2, 255])], 'scan.jpeg', { type: 'image/jpeg' })
    await selectFile(file)
    expect(onValidContentRead).toHaveBeenCalledWith([1, 2, 255], file)
    expect(onStatusChange).toHaveBeenCalledWith('valid')
  })
})

it('preserves validation failures without calling the success callback', async () => {
  await withTestSetup(async () => {
    const error = new Error('Unsupported wallet export')
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FileDropReader {...common} readAs="text" acceptedFileTypes={['txt']} validationFn={() => Err(error)} />
        </ChakraProvider>,
      )
    })
    await selectFile(new File(['invalid'], 'wallet.txt', { type: 'text/plain' }))
    expect(onStatusChange).toHaveBeenCalledWith('invalid')
    expect(onInvalidContentRead).toHaveBeenCalledWith(error)
    expect(onValidContentRead).not.toHaveBeenCalled()
  })
})

it('rejects the wrong file type before validation', async () => {
  await withTestSetup(async () => {
    const validate = vi.fn((text: string) => Ok(text))
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FileDropReader {...common} readAs="text" acceptedFileTypes={['txt']} validationFn={validate} />
        </ChakraProvider>,
      )
    })
    await selectFile(new File(['image'], 'scan.png', { type: 'image/png' }))
    expect(onStatusChange).toHaveBeenCalledWith('invalid')
    expect(onInvalidContentRead).toHaveBeenCalledWith(expect.any(Error))
    expect(validate).not.toHaveBeenCalled()
  })
})

it('rejects empty text before calling the content validator', async () => {
  await withTestSetup(async () => {
    const validate = vi.fn((text: string) => Ok(text))
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FileDropReader {...common} readAs="text" acceptedFileTypes={['txt']} validationFn={validate} />
        </ChakraProvider>,
      )
    })
    await selectFile(new File([], 'empty.txt', { type: 'text/plain' }))
    expect(validate).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenCalledWith('invalid')
    expect(onInvalidContentRead).toHaveBeenCalledWith(new Error('Invalid file'))
    expect(onValidContentRead).not.toHaveBeenCalled()
  })
})

it('passes a zero-length ArrayBuffer to the content validator', async () => {
  await withTestSetup(async () => {
    const validate = vi.fn((bytes: ArrayBuffer) => Ok(bytes.byteLength))
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FileDropReader {...common} readAs="arrayBuffer" acceptedFileTypes={['png']} validationFn={validate} />
        </ChakraProvider>,
      )
    })
    const file = new File([], 'empty.png', { type: 'image/png' })
    await selectFile(file)
    expect(validate).toHaveBeenCalledTimes(1)
    expect(onValidContentRead).toHaveBeenCalledWith(0, file)
    expect(onStatusChange).toHaveBeenCalledWith('valid')
    expect(onInvalidContentRead).not.toHaveBeenCalled()
  })
})

it('opens the file picker once without submitting its containing form', async () => {
  await withTestSetup(async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => {
      event.preventDefault()
    })
    await act(async () => {
      root.render(
        <ChakraProvider>
          <form onSubmit={onSubmit}>
            <FileDropReader {...common} readAs="text" acceptedFileTypes={['txt']} validationFn={Ok} />
          </form>
        </ChakraProvider>,
      )
    })
    const input = host.querySelector('input')
    const button = host.querySelector('button')
    assert(input instanceof HTMLInputElement)
    assert(button instanceof HTMLButtonElement)
    const openPicker = vi.spyOn(input, 'click').mockImplementation(() => {})
    expect(button.type).toBe('button')
    expect(button.contains(input)).toBe(false)
    await act(async () => {
      button.click()
    })
    expect(openPicker).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    openPicker.mockRestore()
  })
})
