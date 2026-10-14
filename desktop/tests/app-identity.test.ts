import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import {
  APP_DISPLAY_NAME,
  DATA_FOLDER_NAME,
  DEVELOPMENT_DATA_FOLDER_NAME,
  readReleaseVersion,
  userDataPath,
} from '../src/app-identity'

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

it('reads the release a packaged build was made from, and nothing from a run from source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bcc-release-version-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const file = join(directory, 'package.json')
  // As electron-builder writes it, with build.sh's release added to the package's own metadata.
  const read = (bccReleaseVersion?: string): string | undefined => {
    writeFileSync(file, JSON.stringify({ ...packageJson, bccReleaseVersion }, null, 2))
    return readReleaseVersion(file)
  }
  expect(read('0.6.0:0')).toBe('0.6.0:0')
  expect(read()).toBeUndefined()
  expect(read('0.6.0')).toBeUndefined()
  expect(readReleaseVersion(join(directory, 'missing.json'))).toBeUndefined()
})
