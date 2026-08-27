import { sdk } from './sdk'
import { uiPort } from './utils'

export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  const uiMulti = sdk.MultiHost.of(effects, 'ui')
  const uiOrigin = await uiMulti.bindPort(uiPort, { protocol: 'http' })

  const webInterface = sdk.createInterface(effects, {
    name: 'Web Interface',
    id: 'main',
    description: 'The Bitcoin Control Center web interface.',
    type: 'ui',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })

  return [await uiOrigin.export([webInterface])]
})
