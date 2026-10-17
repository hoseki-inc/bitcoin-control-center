import { buildManifest } from '@start9labs/start-sdk'
import { dependencies } from './dependencies'
import { manifest as sdkManifest } from './manifest'
import { versionGraph } from './versions'

export { createBackup } from './backups'
export { main } from './main'
export { init, uninit } from './init'
export { actions } from './actions'

export const manifest = buildManifest(versionGraph, sdkManifest, dependencies)
