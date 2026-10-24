import { actions } from './actions'
import { restoreInit } from './backups'
import { dependencies } from './dependencies'
import { setInterfaces } from './interfaces'
import { requirePin } from './pinTask'
import { sdk } from './sdk'
import { versionGraph } from './versions'

export const init = sdk.setupInit(restoreInit, versionGraph, setInterfaces, actions, dependencies, requirePin)
export const uninit = sdk.setupUninit(versionGraph)
