import type { T } from '@start9labs/start-sdk'
import { expect, it, onTestFinished, vi } from 'vitest'
import { manifest } from '../startos/manifest'
import { resolveMempoolUrl } from '../startos/mempool'

function effectsForMempool(installed: boolean): T.Effects {
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

it('mempool is optional while Electrs remains required', () => {
  expect(manifest.dependencies.mempool.optional).toBe(true)
  expect(manifest.dependencies.electrs.optional).toBe(false)
})
it('uses the installed mempool bridge endpoint without hardcoding its address', async () => {
  await expect(resolveMempoolUrl(effectsForMempool(true))).resolves.toBe('http://172.18.0.4:8080')
})
it('uses public mempool when the optional service is absent', async () => {
  await expect(resolveMempoolUrl(effectsForMempool(false))).resolves.toBe('https://mempool.space')
})
it('an explicit URL overrides discovery', async () => {
  const effects = effectsForMempool(true)
  const discovery = vi.spyOn(effects, 'getServiceInterface')
  await expect(resolveMempoolUrl(effects, 'https://my-mempool.test')).resolves.toBe('https://my-mempool.test')
  expect(discovery).not.toHaveBeenCalled()
})
