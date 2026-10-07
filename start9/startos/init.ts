import { actions } from './actions'
import { restoreInit } from './backups'
import { setDependencies } from './dependencies'
import { setInterfaces } from './interfaces'
import { sdk } from './sdk'
import { versionGraph } from './versions'

export const init = sdk.setupInit(restoreInit, versionGraph, setDependencies, setInterfaces, actions)
export const uninit = sdk.setupUninit(versionGraph)
