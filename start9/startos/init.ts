import { actions } from './actions'
import { restoreInit } from './backups'
import { dependencies } from './dependencies'
import { setInterfaces } from './interfaces'
import { sdk } from './sdk'
import { versionGraph } from './versions'

export const init = sdk.setupInit(restoreInit, versionGraph, setInterfaces, actions, dependencies)
export const uninit = sdk.setupUninit(versionGraph)
