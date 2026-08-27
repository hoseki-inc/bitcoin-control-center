import { sdk } from './sdk'
import { uiPort } from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  return sdk.Daemons.of(effects).addDaemon('primary', {
    subcontainer: await sdk.SubContainer.of(
      effects,
      { imageId: 'main' },
      sdk.Mounts.of().mountVolume({
        volumeId: 'main',
        subpath: null,
        mountpoint: '/data',
        readonly: false,
      }),
      'hoseki-sentinel-sub',
    ),
    exec: { command: ['/usr/local/bin/docker_entrypoint.sh'] },
    ready: {
      display: 'Web Interface',
      fn: () =>
        sdk.healthCheck.checkPortListening(effects, uiPort, {
          successMessage: 'Bitcoin Control Center is running and responding.',
          errorMessage: 'Bitcoin Control Center is not responding.',
        }),
    },
    requires: [],
  })
})
