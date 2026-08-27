import { actions } from './actions'
import { restoreInit } from './backups'
import { setInterfaces } from './interfaces'
import { sdk } from './sdk'
import { versionGraph } from './versions'

export const init = sdk.setupInit(restoreInit, versionGraph, setInterfaces, actions)
export const uninit = sdk.setupUninit(versionGraph)
