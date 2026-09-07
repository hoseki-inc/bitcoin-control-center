import * as path from 'node:path'
import { type BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'

export function setupTray(mainWindow: BrowserWindow): Tray {
  const iconPath = path.join(__dirname, '..', 'resources', 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  const tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Control Center',
      click: (): void => {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: (): void => {
        app.quit()
      },
    },
  ])

  tray.setToolTip('Bitcoin Control Center')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (mainWindow.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow.show()
    }
  })

  return tray
}
