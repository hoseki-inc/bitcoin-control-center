import { configFile } from './fileModels/configFile'
import { resolveMempoolUrl } from './mempool'
import { sdk } from './sdk'
import { uiPort } from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  // The SDK resolves only enabled addresses. Watching the resulting hostnames
  // restarts Sentinel when an interface is enabled, disabled, or changes IP.
  const allowedHosts = await sdk.serviceInterface
    .getOwn(effects, 'main', (webInterface) =>
      [...new Set(webInterface?.addressInfo?.hostnames.map(({ hostname }) => hostname) ?? [])].sort().join(','),
    )
    .const()

  const config = await configFile.read().const(effects)
  const mempoolUrl = await resolveMempoolUrl(effects, config?.['mempool-url'])
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
    exec: {
      command: ['/usr/local/bin/docker_entrypoint.sh'],
      env: { SENTINEL_ALLOWED_HOSTS: allowedHosts, MEMPOOL_API_URL: mempoolUrl },
    },
    ready: {
      display: 'Web Interface',
      fn: async () =>
        sdk.healthCheck.checkPortListening(effects, uiPort, {
          successMessage: 'Bitcoin Control Center is running and responding.',
          errorMessage: 'Bitcoin Control Center is not responding.',
        }),
    },
    requires: [],
  })
})
