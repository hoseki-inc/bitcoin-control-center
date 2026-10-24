import { resolveElectrs } from './electrs'
import { configFile } from './fileModels/configFile'
import { pinFile } from './fileModels/pinFile'
import { resolveMempoolUrl } from './mempool'
import { sdk } from './sdk'
import { uiPort } from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  // The SDK resolves only enabled addresses. Watching the resulting hostnames
  // restarts Sentinel when an interface is enabled, disabled, or changes IP.
  const allowedHosts = await sdk.host
    .getOwn(effects, 'ui', (host) =>
      [...new Set(host?.bindings[uiPort]?.interfaces.main?.addressInfo.hostnames.map(({ hostname }) => hostname) ?? [])]
        .sort()
        .join(','),
    )
    .const()

  const config = await configFile.read().const(effects)
  // Set PIN writes this file after leaving the new PIN for Sentinel, so watching it restarts Sentinel to apply it.
  await pinFile.read().const(effects)
  const mempoolUrl = await resolveMempoolUrl(effects, config?.['mempool-url'])
  const electrs = await resolveElectrs(effects)
  return sdk.Daemons.of(effects).addDaemon('primary', {
    subcontainer: sdk.SubContainer.of(
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
      env: {
        SENTINEL_ALLOWED_HOSTS: allowedHosts,
        MEMPOOL_API_URL: mempoolUrl,
        ELECTRUM_HOST: electrs.host,
        ELECTRUM_PORT: electrs.port,
        // Every route needs the PIN, set from the Set PIN action and accepted over HTTPS only.
        SENTINEL_PIN: 'startos',
      },
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
