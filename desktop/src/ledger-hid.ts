import type {
  BrowserWindow,
  HIDDevice,
  HidDeviceAddedDetails,
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  MessageBoxOptions,
  MessageBoxReturnValue,
  SelectHidDeviceDetails,
  WebFrameMain,
} from 'electron'
import type { LedgerHidUpdate } from './ledger-hid-api'

const LEDGER_VENDOR_ID = 0x2c97
const REQUEST_TIMEOUT_MS = 120_000

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)
}

function isDeviceId(value: unknown): value is string {
  return typeof value === 'string'
}

type Request = {
  id: string
  frame: WebFrameMain
  callback?: (deviceId?: string | null) => void
  devices: Map<string, HIDDevice>
  needsChoice: boolean
  cancelled: boolean
  timer: ReturnType<typeof setTimeout>
  autoSelectTimer?: ReturnType<typeof setTimeout>
}

type NativeRequest = {
  frame: WebFrameMain
  callback: (deviceId?: string | null) => void
  devices: Map<string, HIDDevice>
  abort: AbortController
  timer: ReturnType<typeof setTimeout>
}

export function setupLedgerHidAccess(
  window: BrowserWindow,
  appOrigin: string,
  ipc: IpcMain,
  showDeviceChooser: (window: BrowserWindow, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>,
): void {
  const contents = window.webContents
  const session = contents.session
  let request: Request | undefined
  let nativeRequest: NativeRequest | undefined

  function isAppFrame(frame: WebFrameMain | null): frame is WebFrameMain {
    if (window.isDestroyed() || contents.isDestroyed() || !frame || frame !== contents.mainFrame) {
      return false
    }
    try {
      return URL.canParse(frame.url) && new URL(frame.url).origin === appOrigin
    } catch {
      return false
    }
  }

  function isAppIpc(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return event.sender === contents && isAppFrame(event.senderFrame)
  }

  function publish(current: Request, status: LedgerHidUpdate['status']): void {
    if (!isAppFrame(current.frame)) {
      return
    }
    // Do not expose serial numbers, HID reports, or arbitrary Electron objects.
    const update: LedgerHidUpdate = {
      requestId: current.id,
      status,
      devices: [...current.devices.values()].map((device) => ({ id: device.deviceId, name: device.name || 'Ledger' })),
    }
    contents.send('ledger-hid:update', update)
  }

  function finish(deviceId?: string, status: LedgerHidUpdate['status'] = 'cancelled'): void {
    const current = request
    if (!current) {
      return
    }
    clearTimeout(current.timer)
    clearTimeout(current.autoSelectTimer)
    const allowed =
      !current.cancelled &&
      isAppFrame(current.frame) &&
      deviceId != null &&
      deviceId !== '' &&
      current.devices.has(deviceId)
    publish(current, allowed ? 'connecting' : status)
    if (current.callback) {
      request = undefined
      current.callback(allowed ? deviceId : undefined)
    } else {
      // The browser event can arrive after Cancel. Keep its reservation until we
      // deny that callback, or the renderer confirms requestDevice has settled.
      current.cancelled = true
    }
  }

  function finishNative(deviceId?: string): void {
    const current = nativeRequest
    if (!current) {
      return
    }
    nativeRequest = undefined
    clearTimeout(current.timer)
    current.abort.abort()
    const allowed = isAppFrame(current.frame) && deviceId != null && deviceId !== '' && current.devices.has(deviceId)
    current.callback(allowed ? deviceId : undefined)
  }

  function updateDevices(): void {
    const current = request
    if (!current?.callback || current.cancelled) {
      return
    }
    if (!isAppFrame(current.frame)) {
      finish()
      return
    }
    clearTimeout(current.autoSelectTimer)
    if (current.devices.size > 1) {
      current.needsChoice = true
    }
    publish(current, current.devices.size === 1 && !current.needsChoice ? 'connecting' : 'choosing')
    if (current.devices.size === 1 && !current.needsChoice) {
      // Connect was the user's explicit approval. Briefly collect hotplug events
      // so two devices arriving together still result in an explicit choice.
      current.autoSelectTimer = setTimeout(() => {
        if (request === current && current.devices.size === 1) {
          finish(current.devices.keys().next().value)
        }
      }, 150)
    }
  }

  ipc.handle('ledger-hid:begin', (event, id: unknown): boolean => {
    if (!isAppIpc(event) || !isRequestId(id) || request || nativeRequest) {
      return false
    }
    request = {
      id,
      frame: contents.mainFrame,
      devices: new Map(),
      needsChoice: false,
      cancelled: false,
      timer: setTimeout(() => {
        finish(undefined, 'expired')
      }, REQUEST_TIMEOUT_MS),
    }
    return true
  })
  ipc.handle('ledger-hid:choose', (event, id: unknown, deviceId: unknown): boolean => {
    if (!isAppIpc(event) || !request?.callback || request.cancelled || request.id !== id || !isDeviceId(deviceId)) {
      return false
    }
    if (!isAppFrame(request.frame) || !request.devices.has(deviceId)) {
      return false
    }
    finish(deviceId)
    return true
  })
  const onCancel = (event: IpcMainEvent, id: unknown): void => {
    if (isAppIpc(event) && request?.id === id) {
      finish()
    }
  }
  ipc.on('ledger-hid:cancel', onCancel)
  const onEnd = (event: IpcMainEvent, id: unknown): void => {
    if (!isAppIpc(event) || request?.id !== id) {
      return
    }
    finish()
    request = undefined
  }
  ipc.on('ledger-hid:end', onEnd)

  async function selectNative(
    details: SelectHidDeviceDetails,
    callback: (deviceId?: string | null) => void,
  ): Promise<void> {
    const devices = details.deviceList.filter((device) => device.vendorId === LEDGER_VENDOR_ID)
    if (!isAppFrame(details.frame) || !devices.length) {
      callback()
      return
    }
    const current: NativeRequest = {
      frame: details.frame,
      callback,
      devices: new Map(devices.map((device) => [device.deviceId, device])),
      abort: new AbortController(),
      timer: setTimeout(() => {
        finishNative()
      }, REQUEST_TIMEOUT_MS),
    }
    nativeRequest = current
    try {
      const { response } = await showDeviceChooser(window, {
        type: 'question',
        title: 'Connect Ledger',
        message: 'Choose a Ledger to connect',
        detail: 'Allow Bitcoin Control Center to connect to the Ledger you select.',
        buttons: [...devices.map((device) => device.name || 'Ledger'), 'Cancel'],
        defaultId: 0,
        cancelId: devices.length,
        noLink: true,
        signal: current.abort.signal,
      })
      if (nativeRequest === current) {
        finishNative(devices[response]?.deviceId)
      }
    } catch {
      // A closed chooser or window cancels the request.
      if (nativeRequest === current) {
        finishNative()
      }
    }
  }

  const onSelect = (
    event: Electron.Event,
    details: SelectHidDeviceDetails,
    callback: (deviceId?: string | null) => void,
  ): void => {
    event.preventDefault()
    if (!isAppFrame(details.frame)) {
      callback()
      return
    }
    if (nativeRequest) {
      callback()
      return
    }
    if (!request) {
      // Other connection entry points retain an explicit native permission prompt.
      void selectNative(details, callback)
      return
    }
    if (request.callback || request.frame !== details.frame) {
      callback()
      return
    }
    request.callback = callback
    if (request.cancelled) {
      finish()
      return
    }
    request.devices = new Map(
      details.deviceList
        .filter((device) => device.vendorId === LEDGER_VENDOR_ID)
        .map((device) => [device.deviceId, device]),
    )
    updateDevices()
  }
  const onAdded = (_event: Electron.Event, details: HidDeviceAddedDetails): void => {
    if (
      !request ||
      request.cancelled ||
      details.frame !== request.frame ||
      !isAppFrame(details.frame) ||
      details.device.vendorId !== LEDGER_VENDOR_ID
    ) {
      return
    }
    request.devices.set(details.device.deviceId, details.device)
    updateDevices()
  }
  const onRemoved = (_event: Electron.Event, details: HidDeviceAddedDetails): void => {
    if (nativeRequest && details.frame === nativeRequest.frame) {
      nativeRequest.devices.delete(details.device.deviceId)
    }
    if (!request || details.frame !== request.frame || !isAppFrame(details.frame)) {
      return
    }
    request.devices.delete(details.device.deviceId)
    updateDevices()
  }
  const onNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    if (event.isMainFrame) {
      finish()
      finishNative()
    }
  }
  const onGone = (): void => {
    finish()
    request = undefined
    finishNative()
  }
  session.on('select-hid-device', onSelect)
  session.on('hid-device-added', onAdded)
  session.on('hid-device-removed', onRemoved)
  contents.on('did-start-navigation', onNavigation)
  contents.on('render-process-gone', onGone)
  window.once('closed', () => {
    onGone()
    session.off('select-hid-device', onSelect)
    session.off('hid-device-added', onAdded)
    session.off('hid-device-removed', onRemoved)
    contents.off('did-start-navigation', onNavigation)
    contents.off('render-process-gone', onGone)
    ipc.removeHandler('ledger-hid:begin')
    ipc.removeHandler('ledger-hid:choose')
    ipc.off('ledger-hid:cancel', onCancel)
    ipc.off('ledger-hid:end', onEnd)
  })
}
