import type { T } from '@start9labs/start-sdk'
import { expect, it, onTestFinished, vi } from 'vitest'
import { dependencies } from '../startos/dependencies'
import { configSchema } from '../startos/fileModels/configFile'
import { manifest } from '../startos/index'
import { resolveMempoolUrl } from '../startos/mempool'

type BridgeHost = { hostname: string; port: number; ssl: boolean }

/** Effects exposing one dependency binding, as the real SDK bridge lookup reads it. */
function effectsForBinding(
  packageId: string,
  hostId: string,
  internalPort: number,
  available: BridgeHost[] | null,
): T.Effects {
  const leave: (() => void)[] = []
  const effects = {
    isInContext: true,
    constRetry: vi.fn(),
    onLeaveContext: (callback: () => void) => {
      leave.push(callback)
    },
    getOsIp: vi.fn(async () => '10.0.3.1'),
    getHostInfo: vi.fn(async (options: Parameters<T.Effects['getHostInfo']>[0]) => {
      expect(options.packageId).toBe(packageId)
      expect(options.hostId).toBe(hostId)
      return available == null
        ? null
        : {
            bindings: {
              [internalPort]: {
                addresses: {
                  available: available.map((address) => ({
                    ...address,
                    public: false,
                    metadata: { kind: 'ipv4', gateway: 'lxcbr0' },
                  })),
                  enabled: [],
                  disabled: [],
                  lanEnabled: [],
                },
                interfaces: {},
              },
            },
          }
    }),
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

const plainMempool = { hostname: '10.0.3.1', port: 8080, ssl: false }
const tlsMempool = { hostname: '10.0.3.1', port: 8443, ssl: true }
const effectsForMempool = (available: BridgeHost[] | null): T.Effects =>
  effectsForBinding('mempool', 'main', 8080, available)

it('publishes Electrs and mempool as required running dependencies', () => {
  expect(dependencies.manifestDependencies()).toMatchObject({
    electrs: { optional: false, kind: 'running', healthChecks: ['electrs', 'sync'] },
    mempool: { optional: false, kind: 'running', healthChecks: ['webui'] },
  })
  expect(Object.keys(manifest.dependencies).sort()).toEqual(['electrs', 'mempool'])
})
it('uses the installed mempool bridge endpoint without hardcoding its address', async () => {
  await expect(resolveMempoolUrl(effectsForMempool([plainMempool]))).resolves.toBe('http://10.0.3.1:8080')
})
it('prefers the plain HTTP bridge address even when a TLS address is listed first', async () => {
  await expect(resolveMempoolUrl(effectsForMempool([tlsMempool, plainMempool]))).resolves.toBe('http://10.0.3.1:8080')
})
it('uses public mempool when the service is absent', async () => {
  await expect(resolveMempoolUrl(effectsForMempool(null))).resolves.toBe('https://mempool.space')
})
it('an explicit URL overrides discovery', async () => {
  const effects = effectsForMempool([plainMempool])
  const discovery = vi.spyOn(effects, 'getHostInfo')
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
it('keeps config keys the StartOS model does not declare', () => {
  expect(configSchema.parse({ 'log-level': 'debug', legacy: { kept: true } })).toMatchObject({ legacy: { kept: true } })
})
