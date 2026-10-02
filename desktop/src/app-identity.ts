import * as path from 'node:path'

/** Shown in the app menu, the About panel, and dialogs. */
export const APP_DISPLAY_NAME = 'Bitcoin Control Center'

/**
 * The folder every release has kept its data in, named after the package ("desktop"). Electron
 * names the folder after the app, so it's pinned here: following the display name would start
 * existing users in an empty folder, as if their wallets were gone.
 */
export const DATA_FOLDER_NAME = 'desktop'

/** Running Electron from source gets its own folder, so it never opens the installed app's wallets. */
export const DEVELOPMENT_DATA_FOLDER_NAME = 'desktop-dev'

export function userDataPath(appDataPath: string, packaged: boolean): string {
  return path.join(appDataPath, packaged ? DATA_FOLDER_NAME : DEVELOPMENT_DATA_FOLDER_NAME)
}
