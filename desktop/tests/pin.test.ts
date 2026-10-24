import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { setupPinAccess } from '../src/pin'
import { createWindowFixture } from './window-fixture'

const ORIGIN = 'http://localhost:49172'

type Handler = (event: IpcMainInvokeEvent) => Promise<boolean>

function setup(confirmed: boolean) {
  const { window, contents, send } = createWindowFixture(ORIGIN)
  const handlers = new Map<string, Handler>()
  const ipcMain: Pick<IpcMain, 'handle'> = {
    handle: (channel, listener) => {
      handlers.set(channel, async (event) => {
        const result: unknown = await listener(event)
        return result === true
      })
    },
  }
  let computerLock: (() => void) | undefined
  const resetAndRestart = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const confirmAdmin = vi.fn<() => Promise<boolean>>().mockResolvedValue(confirmed)
  setupPinAccess(window, ORIGIN, ipcMain, {
    confirmAdmin,
    resetAndRestart,
    onComputerLock: (listener) => {
      computerLock = listener
    },
  })
  const event = (sender: WebContents, url: string): IpcMainInvokeEvent => {
    // SAFETY: the handler reads only `sender` and `senderFrame.url`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Native Electron supplies the rest of the event.
    return { sender, senderFrame: { url } } as IpcMainInvokeEvent
  }
  const reset = handlers.get('pin:reset')
  if (!reset) {
    throw new Error('Expected a pin:reset handler')
  }
  return {
    window,
    contents,
    send,
    lockComputer: () => computerLock?.(),
    reset,
    event,
    confirmAdmin,
    resetAndRestart,
  }
}

describe('desktop PIN access', () => {
  it('resets and restarts only after an administrator confirms', async () => {
    const confirmed = setup(true)
    await expect(confirmed.reset(confirmed.event(confirmed.contents, `${ORIGIN}/home`))).resolves.toBe(true)
    expect(confirmed.resetAndRestart).toHaveBeenCalledOnce()

    const refused = setup(false)
    await expect(refused.reset(refused.event(refused.contents, `${ORIGIN}/home`))).resolves.toBe(false)
    expect(refused.resetAndRestart).not.toHaveBeenCalled()
  })

  it('lets the person try again when the reset fails', async () => {
    const { reset, event, contents, confirmAdmin, resetAndRestart } = setup(true)
    resetAndRestart.mockRejectedValueOnce(new Error('ENOSPC'))
    await expect(reset(event(contents, `${ORIGIN}/home`))).resolves.toBe(false)
    await expect(reset(event(contents, `${ORIGIN}/home`))).resolves.toBe(true)
    expect(confirmAdmin).toHaveBeenCalledTimes(2)
  })

  it('lets the person try again after a cancelled prompt', async () => {
    const { reset, event, contents, confirmAdmin } = setup(false)
    await reset(event(contents, `${ORIGIN}/home`))
    await reset(event(contents, `${ORIGIN}/home`))
    expect(confirmAdmin).toHaveBeenCalledTimes(2)
  })

  it('ignores requests from another page, without asking', async () => {
    const { reset, event, contents, confirmAdmin, resetAndRestart } = setup(true)
    await expect(reset(event(contents, 'https://example.com/'))).resolves.toBe(false)
    expect(confirmAdmin).not.toHaveBeenCalled()
    expect(resetAndRestart).not.toHaveBeenCalled()
  })

  it('locks the window when it closes to the tray', () => {
    const { window, send } = setup(true)
    window.emit('hide')
    expect(send.mock.calls.map(([channel]) => channel)).toEqual(['pin:lock'])
  })

  it('locks the window when the computer sleeps or its screen locks', () => {
    const { lockComputer, send } = setup(true)
    lockComputer()
    expect(send.mock.calls.map(([channel]) => channel)).toEqual(['pin:lock'])
  })
})
