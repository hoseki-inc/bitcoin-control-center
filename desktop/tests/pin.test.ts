import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { setupPinAccess } from '../src/pin'
import { createWindowFixture } from './window-fixture'

const ORIGIN = 'http://localhost:49172'

type Handler = (event: IpcMainInvokeEvent) => Promise<boolean>

function setup(confirmed: boolean, dataDir = mkdtempSync(join(tmpdir(), 'desktop-pin-'))) {
  onTestFinished(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })
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
  const restart = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const confirmAdmin = vi.fn<() => Promise<boolean>>().mockResolvedValue(confirmed)
  setupPinAccess(window, ORIGIN, ipcMain, {
    dataDir,
    confirmAdmin,
    restart,
  })
  const fromApp = (sender: WebContents = contents, url = `${ORIGIN}/home`): IpcMainInvokeEvent => {
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
    send,
    reset,
    fromApp,
    confirmAdmin,
    restart,
    request: join(dataDir, 'reset-pin'),
  }
}

describe('desktop PIN access', () => {
  it('leaves a reset request for Sentinel and restarts, only after an administrator confirms', async () => {
    const confirmed = setup(true)
    await expect(confirmed.reset(confirmed.fromApp())).resolves.toBe(true)
    expect(readFileSync(confirmed.request, 'utf8')).toBe('reset\n')
    expect(statSync(confirmed.request).mode & 0o777).toBe(0o600)
    expect(confirmed.restart).toHaveBeenCalledOnce()

    const refused = setup(false)
    await expect(refused.reset(refused.fromApp())).resolves.toBe(false)
    expect(existsSync(refused.request)).toBe(false)
    expect(refused.restart).not.toHaveBeenCalled()
  })

  it('keeps running, and lets the person try again, when the request can’t be written', async () => {
    const { reset, fromApp, confirmAdmin, restart } = setup(true, join(tmpdir(), 'desktop-pin-missing', 'data'))
    await expect(reset(fromApp())).resolves.toBe(false)
    expect(restart).not.toHaveBeenCalled()
    await expect(reset(fromApp())).resolves.toBe(false)
    expect(confirmAdmin).toHaveBeenCalledTimes(2)
  })

  it('lets the person try again after a cancelled prompt', async () => {
    const { reset, fromApp, confirmAdmin } = setup(false)
    await reset(fromApp())
    await reset(fromApp())
    expect(confirmAdmin).toHaveBeenCalledTimes(2)
  })

  it('ignores requests from another page, without asking', async () => {
    const { reset, fromApp, confirmAdmin, restart } = setup(true)
    await expect(reset(fromApp(undefined, 'https://example.com/'))).resolves.toBe(false)
    expect(confirmAdmin).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
  })

  it('locks the window when it closes to the tray, but not when it only hides, as for another full-screen space', () => {
    const { window, send } = setup(true)
    window.emit('hide')
    expect(send).not.toHaveBeenCalled()
    window.emit('close')
    expect(send.mock.calls.map(([channel]) => channel)).toEqual(['pin:lock'])
  })
})
