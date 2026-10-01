import { join } from 'node:path'
import { expect, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import { APP_DISPLAY_NAME, DATA_FOLDER_NAME, DEVELOPMENT_DATA_FOLDER_NAME, userDataPath } from '../src/app-identity'

it('keeps existing data in the folder every release has used, whatever the app is called', () => {
  const appData = join('/Users', 'me', 'Library', 'Application Support')
  expect(DATA_FOLDER_NAME).toBe('desktop')
  expect(DATA_FOLDER_NAME).toBe(packageJson.name)
  expect(userDataPath(appData, true)).toBe(join(appData, 'desktop'))
  expect(APP_DISPLAY_NAME).not.toBe(DATA_FOLDER_NAME)
})

it('keeps Electron runs from source away from the installed app data', () => {
  const appData = join('/Users', 'me', 'Library', 'Application Support')
  expect(userDataPath(appData, false)).toBe(join(appData, DEVELOPMENT_DATA_FOLDER_NAME))
  expect(userDataPath(appData, false)).not.toBe(userDataPath(appData, true))
})
