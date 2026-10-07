import type { T } from '@start9labs/start-sdk'
import { expect, it, onTestFinished, vi } from 'vitest'
import { setDependencies } from '../startos/dependencies'
import { configSchema } from '../startos/fileModels/configFile'
import { manifest } from '../startos/manifest'
import { resolveMempoolUrl } from '../startos/mempool'

function effectsForMempool(installed: boolean, tlsFirst = false): T.Effects {
  const leave: (() => void)[] = []
  const effects = {
    isInContext: true,
    constRetry: vi.fn(),
    onLeaveContext: (callback: () => void) => {
      leave.push(callback)
    },
    getServiceInterface: vi.fn(
      async ({ packageId, serviceInterfaceId }: Parameters<T.Effects['getServiceInterface']>[0]) => {
        expect(packageId).toBe('mempool')
        expect(serviceInterfaceId).toBe('webui')
        return installed
          ? {
              id: 'webui',
              addressInfo: { hostId: 'mempool-ui', internalPort: 8080, scheme: 'http', sslScheme: 'https', suffix: '' },
            }
          : null
      },
    ),
    getHostInfo: vi.fn(async () => ({
      bindings: {
        8080: {
          addresses: {
            available: [
              ...(tlsFirst
                ? [
                    {
                      hostname: '172.18.0.4',
                      port: 8443,
                      ssl: true,
                      public: false,
                      metadata: { kind: 'ipv4', gateway: 'lxcbr0' },
                    },
                  ]
                : []),
              {
                hostname: '172.18.0.4',
                port: 8080,
                ssl: false,
                public: false,
                metadata: { kind: 'ipv4', gateway: 'lxcbr0' },
              },
            ],
            enabled: [],
            disabled: [],
          },
        },
      },
    })),
  }
  onTestFinished(() => {
    effects.isInContext = false
    for (const callback of leave) {
      callback()
    }
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: The real SDK lookup uses only these Effects methods; no daemon or network is started.
  return effects as T.Effects
}

it('requires both mempool and Electrs', () => {
  expect(manifest.dependencies.mempool.optional).toBe(false)
  expect(manifest.dependencies.electrs.optional).toBe(false)
})
it('registers Electrs and mempool as running dependencies', async () => {
  const set = vi.fn<T.Effects['setDependencies']>(async () => null)
  const effects: Pick<T.Effects, 'setDependencies'> = { setDependencies: set }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: setupDependencies calls only setDependencies.
  await setDependencies(effects as T.Effects)
  expect(set).toHaveBeenCalledWith({
    dependencies: [
      { id: 'electrs', kind: 'running', versionRange: '*', healthChecks: [] },
      { id: 'mempool', kind: 'running', versionRange: '*', healthChecks: [] },
    ],
  })
})
it('uses the installed mempool bridge endpoint without hardcoding its address', async () => {
  await expect(resolveMempoolUrl(effectsForMempool(true))).resolves.toBe('http://172.18.0.4:8080')
})
it('prefers the plain HTTP bridge address even when a TLS address is listed first', async () => {
  await expect(resolveMempoolUrl(effectsForMempool(true, true))).resolves.toBe('http://172.18.0.4:8080')
})
it('uses public mempool when the service is absent', async () => {
  await expect(resolveMempoolUrl(effectsForMempool(false))).resolves.toBe('https://mempool.space')
})
it('an explicit URL overrides discovery', async () => {
  const effects = effectsForMempool(true)
  const discovery = vi.spyOn(effects, 'getServiceInterface')
  await expect(resolveMempoolUrl(effects, 'https://my-mempool.test')).resolves.toBe('https://my-mempool.test')
  expect(discovery).not.toHaveBeenCalled()
})
it.each(['https://user:pass@node.local', 'https://node.local/?x=1', 'https://node.local/#top', 'ftp://node.local'])(
  'rejects a mempool override that cannot work: %s',
  (url) => {
    expect(configSchema.safeParse({ 'mempool-url': url }).success).toBe(false)
  },
)
it('accepts a plain mempool override and an existing config without one', () => {
  expect(configSchema.parse({ 'mempool-url': 'http://10.0.0.5:4080/mempool' })['mempool-url']).toBe(
    'http://10.0.0.5:4080/mempool',
  )
  expect(configSchema.parse({ 'log-level': 'info' })['mempool-url']).toBeNull()
})
