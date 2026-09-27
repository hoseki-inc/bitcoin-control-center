import { EventEmitter } from 'node:events'
import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { showDeviceChooser } from '../src/device-chooser'
import { createWindowFixture } from './window-fixture'

const device = { deviceId: 'trezor', productName: 'Trezor' }

function createHarness(failLoad = false) {
  const parent = createWindowFixture()
  const dialog = createWindowFixture('file:///chooser.html')
  const ipc = new EventEmitter()
  const selected = vi.fn<(id: string) => void>()
  const createWindow = vi.fn<Parameters<typeof showDeviceChooser>[3]>(() => dialog.window)
  if (failLoad) {
    dialog.loadFile.mockRejectedValue(new Error('Missing chooser assets'))
  }
  // SAFETY: The chooser only subscribes and unsubscribes through EventEmitter's on/off methods.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const chooserIpc = ipc as IpcMain
  const chooser = showDeviceChooser(parent.window, 'Trezor', selected, createWindow, chooserIpc)
  const sender = { sender: dialog.contents, senderFrame: dialog.contents.mainFrame }
  chooser.update([device])
  return { parent, dialog, ipc, selected, createWindow, chooser, sender }
}

describe('chooser IPC and window lifecycle', () => {
  it('constructs a sandboxed modal and denies navigation and nested windows', () => {
    const { parent, dialog, createWindow } = createHarness()
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(createWindow.mock.calls[0]?.[0]).toMatchObject({
      parent: parent.window,
      modal: true,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    expect(dialog.open('https://example.com')).toEqual({ action: 'deny' })
    const navigate = { preventDefault: vi.fn<() => void>() }
    const redirect = { preventDefault: vi.fn<() => void>() }
    dialog.contents.emit('will-navigate', navigate, 'https://example.com')
    dialog.contents.emit('will-redirect', redirect, 'https://example.com')
    expect(navigate.preventDefault).toHaveBeenCalledExactlyOnceWith()
    expect(redirect.preventDefault).toHaveBeenCalledExactlyOnceWith()
  })

  it('ignores IPC from another window and from a subframe, including forged cancellation', () => {
    const { parent, ipc, selected, sender } = createHarness()
    ipc.emit('wallet-chooser:select', { ...sender, sender: parent.contents }, device.deviceId)
    ipc.emit('wallet-chooser:select', { ...sender, senderFrame: parent.contents.mainFrame }, device.deviceId)
    ipc.emit('wallet-chooser:select', { ...sender, sender: parent.contents }, '')
    ipc.emit('wallet-chooser:select', { ...sender, senderFrame: null }, '')
    expect(selected).not.toHaveBeenCalled()
    expect(ipc.listenerCount('wallet-chooser:select')).toBe(1)
    ipc.emit('wallet-chooser:select', sender, device.deviceId)
    expect(selected).toHaveBeenCalledExactlyOnceWith(device.deviceId)
  })

  it('ignores malformed IDs and devices absent from the current list', () => {
    const { chooser, ipc, selected, sender } = createHarness()
    ipc.emit('wallet-chooser:select', sender, null)
    ipc.emit('wallet-chooser:select', sender, { deviceId: device.deviceId })
    ipc.emit('wallet-chooser:select', sender, 'unknown-device')
    chooser.update([])
    ipc.emit('wallet-chooser:select', sender, device.deviceId)
    expect(selected).not.toHaveBeenCalled()
    chooser.update([device])
    ipc.emit('wallet-chooser:select', sender, device.deviceId)
    expect(selected).toHaveBeenCalledExactlyOnceWith(device.deviceId)
  })

  it('accepts cancellation from the chooser main frame and completes only once', () => {
    const { chooser, dialog, ipc, selected, sender } = createHarness()
    ipc.emit('wallet-chooser:select', sender, '')
    ipc.emit('wallet-chooser:select', sender, device.deviceId)
    chooser.cancel()
    dialog.window.emit('closed')
    expect(selected).toHaveBeenCalledExactlyOnceWith('')
    expect(dialog.destroy).toHaveBeenCalledExactlyOnceWith()
    expect(ipc.listenerCount('wallet-chooser:select')).toBe(0)
  })

  it('shows the latest device list only after the chooser loads', () => {
    const { chooser, dialog } = createHarness()
    const next = { deviceId: 'second', productName: 'Trezor 2' }
    chooser.update([next])
    expect(dialog.show).not.toHaveBeenCalled()
    dialog.contents.emit('did-finish-load')
    expect(dialog.send).toHaveBeenLastCalledWith('wallet-chooser:devices', { name: 'Trezor', devices: [next] })
    expect(dialog.show).toHaveBeenCalledExactlyOnceWith()
  })

  it('cancels an early request before its page loads without leaking its listener', () => {
    const { chooser, dialog, ipc, selected } = createHarness()
    chooser.cancel()
    chooser.update([device])
    expect(selected).toHaveBeenCalledExactlyOnceWith('')
    expect(dialog.show).not.toHaveBeenCalled()
    expect(dialog.destroy).toHaveBeenCalledExactlyOnceWith()
    expect(ipc.listenerCount('wallet-chooser:select')).toBe(0)
  })

  it('cancels when the chooser window closes', () => {
    const { dialog, ipc, selected } = createHarness()
    dialog.window.emit('closed')
    expect(selected).toHaveBeenCalledExactlyOnceWith('')
    expect(ipc.listenerCount('wallet-chooser:select')).toBe(0)
  })

  it('closes the chooser and cancels once when its renderer crashes', () => {
    const { chooser, dialog, ipc, selected, sender } = createHarness()
    dialog.contents.emit('did-finish-load')
    expect(dialog.show).toHaveBeenCalledExactlyOnceWith()
    dialog.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(dialog.window.isDestroyed()).toBe(true)
    expect(ipc.listenerCount('wallet-chooser:select')).toBe(0)
    ipc.emit('wallet-chooser:select', sender, device.deviceId)
    chooser.cancel()
    dialog.window.emit('closed')
    expect(selected).toHaveBeenCalledExactlyOnceWith('')
    expect(dialog.destroy).toHaveBeenCalledExactlyOnceWith()
  })

  it('cancels a renderer crash before the chooser page finishes loading', () => {
    const { dialog, ipc, selected } = createHarness()
    dialog.contents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1 })
    expect(selected).toHaveBeenCalledExactlyOnceWith('')
    expect(dialog.show).not.toHaveBeenCalled()
    expect(dialog.destroy).toHaveBeenCalledExactlyOnceWith()
    expect(ipc.listenerCount('wallet-chooser:select')).toBe(0)
  })

  it('cancels and removes the IPC listener after a page-load failure', async () => {
    const { dialog, ipc, selected } = createHarness(true)
    await expect.poll(() => selected.mock.calls).toEqual([['']])
    expect(dialog.destroy).toHaveBeenCalledExactlyOnceWith()
    expect(ipc.listenerCount('wallet-chooser:select')).toBe(0)
  })
})
