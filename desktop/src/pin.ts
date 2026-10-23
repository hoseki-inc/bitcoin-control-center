import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

interface PinAccessOptions {
  /** Asks the operating system to confirm a computer administrator; true when it does. */
  confirmAdmin: () => Promise<boolean>
  /** Clears the PIN, keeping all data, and restarts the app so the window can set a new one. */
  resetAndRestart: () => Promise<void>
  /** Calls back when the computer sleeps or its screen locks. */
  onComputerLock: (listener: () => void) => void
}

/**
 * The desktop side of the PIN: a computer administrator can reset a forgotten PIN from the window, and the app
 * locks when the computer sleeps or its screen locks.
 */
export function setupPinAccess(
  window: BrowserWindow,
  appOrigin: string,
  ipcMain: Pick<IpcMain, 'handle'>,
  { confirmAdmin, resetAndRestart, onComputerLock }: PinAccessOptions,
): void {
  const contents = window.webContents
  const fromApp = (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url
    return event.sender === contents && url !== undefined && URL.canParse(url) && new URL(url).origin === appOrigin
  }

  // One prompt at a time, and none once a reset is under way.
  let busy = false
  ipcMain.handle('pin:reset', async (event) => {
    if (!fromApp(event) || busy) {
      return false
    }
    busy = true
    if (!(await confirmAdmin())) {
      busy = false
      return false
    }
    await resetAndRestart()
    return true
  })

  onComputerLock(() => {
    if (!contents.isDestroyed()) {
      contents.send('pin:lock')
    }
  })
}
