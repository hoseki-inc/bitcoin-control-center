import * as fs from 'node:fs'
import * as path from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

interface PinAccessOptions {
  /** Sentinel's data folder, where it looks for a reset request when it starts (see its auth/platform.ts). */
  dataDir: string
  /** Asks the operating system to confirm a computer administrator; true when it does. */
  confirmAdmin: () => Promise<boolean>
  /** Stops the app and starts it again. */
  restart: () => Promise<void>
}

/**
 * The desktop side of the PIN: a computer administrator can reset a forgotten PIN from the window, keeping all data,
 * and the app locks when its window closes (it only hides, to keep running in the tray). Hiding it any other way, as
 * when switching to another full-screen space, doesn't lock.
 */
export function setupPinAccess(
  window: BrowserWindow,
  appOrigin: string,
  ipcMain: Pick<IpcMain, 'handle'>,
  { dataDir, confirmAdmin, restart }: PinAccessOptions,
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
    try {
      if (!(await confirmAdmin())) {
        return false
      }
      // Written before the restart, so if it fails the app keeps running as it was and the person can try again.
      fs.writeFileSync(path.join(dataDir, 'reset-pin'), 'reset\n', { mode: 0o600 })
      await restart()
      return true
    } catch {
      return false
    } finally {
      busy = false
    }
  })

  window.on('close', () => {
    if (!contents.isDestroyed()) {
      contents.send('pin:lock')
    }
  })
}
