import { join } from 'node:path'
import { expect, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import { APP_DISPLAY_NAME, DATA_FOLDER_NAME, userDataPath } from '../src/app-identity'

it('keeps existing data in the folder every release has used, whatever the app is called', () => {
  expect(DATA_FOLDER_NAME).toBe('desktop')
  expect(DATA_FOLDER_NAME).toBe(packageJson.name)
  expect(userDataPath(join('/Users', 'me', 'Library', 'Application Support'))).toBe(
    join('/Users', 'me', 'Library', 'Application Support', 'desktop'),
  )
  expect(APP_DISPLAY_NAME).not.toBe(DATA_FOLDER_NAME)
})
