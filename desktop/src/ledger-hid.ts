import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue, SelectHidDeviceDetails } from 'electron'

const LEDGER_VENDOR_ID = 0x2c97

type ShowDeviceChooser = (window: BrowserWindow, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>

export function setupLedgerHidAccess(
  window: BrowserWindow,
  appOrigin: string,
  showDeviceChooser: ShowDeviceChooser,
): void {
  const contents = window.webContents
  const session = contents.session

  function isAppRequest(details: SelectHidDeviceDetails): boolean {
    if (window.isDestroyed() || contents.isDestroyed() || !details.frame || details.frame !== contents.mainFrame) {
      return false
    }
    const url = details.frame.url
    return URL.canParse(url) && new URL(url).origin === appOrigin
  }

  async function selectDevice(
    details: SelectHidDeviceDetails,
    callback: (deviceId?: string | null) => void,
  ): Promise<void> {
    let selectedDeviceId: string | undefined
    try {
      if (isAppRequest(details)) {
        const devices = details.deviceList.filter((device) => device.vendorId === LEDGER_VENDOR_ID)
        if (devices.length > 0) {
          const { response } = await showDeviceChooser(window, {
            type: 'question',
            title: 'Connect Ledger',
            message: 'Choose a Ledger to connect',
            detail: 'Allow Bitcoin Control Center to connect to the Ledger you select.',
            buttons: [...devices.map((device) => device.name || 'Ledger'), 'Cancel'],
            defaultId: 0,
            cancelId: devices.length,
            noLink: true,
          })
          // The requesting page may have navigated or closed while the chooser was open.
          if (isAppRequest(details)) selectedDeviceId = devices[response]?.deviceId
        }
      }
    } catch {
      // Closing the window or its chooser cancels the device request.
    }
    callback(selectedDeviceId)
  }

  const onSelectDevice = (
    event: Electron.Event,
    details: SelectHidDeviceDetails,
    callback: (deviceId?: string | null) => void,
  ): void => {
    event.preventDefault()
    void selectDevice(details, callback)
  }

  // Electron has no built-in browser device picker. Grant access only after an
  // explicit choice; its normal per-origin device permission storage handles reuse.
  session.on('select-hid-device', onSelectDevice)
  window.once('closed', () => session.off('select-hid-device', onSelectDevice))
}
