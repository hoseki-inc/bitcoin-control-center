import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { daemons } from '@start9labs/start-sdk'
import { afterEach, assert, describe, expect, it, vi } from 'vitest'
import { main } from '../startos/main'
import { sdk } from '../startos/sdk'

type MainOptions = Parameters<typeof main>[0]
type Hostname = { hostname: string; port: number; ssl: boolean; public: boolean; metadata: { kind: string } }

const publicIp = '203.0.113.42'
const publicAddress: Hostname = {
  hostname: publicIp,
  port: 50399,
  ssl: true,
  public: true,
  metadata: { kind: 'ipv4' },
}
const cleanups: (() => void)[] = []

function setupInterface(
  available: Hostname[],
  enabled: string[] = [],
): {
  options: MainOptions
  addresses: { available: Hostname[]; enabled: string[]; disabled: [string, number][] }
  retry: ReturnType<typeof vi.fn>
  changed: () => void
  allowedHosts: () => string
  setPresent: (present: boolean) => void
} {
  const addresses = { available, enabled, disabled: [] as [string, number][] }
  const callbacks = new Set<() => void>()
  const leave: (() => void)[] = []
  const retry = vi.fn()
  let present = true
  const effects = {
    isInContext: true,
    constRetry: retry,
    onLeaveContext: (callback: () => void) => leave.push(callback),
    getServiceInterface: vi.fn(
      async ({ serviceInterfaceId, callback }: Parameters<MainOptions['effects']['getServiceInterface']>[0]) => {
        expect(serviceInterfaceId).toBe('main')
        if (callback) {
          callbacks.add(callback)
        }
        return present
          ? {
              id: 'main',
              addressInfo: { hostId: 'ui', internalPort: 3400, scheme: 'http', sslScheme: 'https', suffix: '' },
            }
          : null
      },
    ),
    getHostInfo: vi.fn(async ({ hostId, callback }: Parameters<MainOptions['effects']['getHostInfo']>[0]) => {
      expect(hostId).toBe('ui')
      if (callback) {
        callbacks.add(callback)
      }
      return { bindings: { 3400: { addresses } } }
    }),
  }
  const addDaemon = vi.fn<(id: string, options: { exec: daemons.ExecCommandOptions }) => void>()
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The SDK builder is nominal; this integration test observes addDaemon without starting a daemon.
  vi.spyOn(sdk.Daemons, 'of').mockReturnValue({ addDaemon } as unknown as ReturnType<typeof sdk.Daemons.of>)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The container is an opaque token passed back to the mocked daemon builder; no container methods run.
  vi.spyOn(sdk.SubContainer, 'of').mockResolvedValue({} as Awaited<ReturnType<typeof sdk.SubContainer.of>>)
  cleanups.push(() => {
    effects.isInContext = false
    leave.forEach((callback) => {
      callback()
    })
  })
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StartOS supplies the full Effects interface; this fixture implements only the host methods exercised by main.
    options: { effects } as unknown as MainOptions,
    addresses,
    retry,
    changed: () => {
      callbacks.forEach((callback) => {
        callback()
      })
    },
    allowedHosts: () => {
      const call = addDaemon.mock.lastCall
      assert.exists(call, 'Expected the Sentinel daemon to be registered')
      const hosts = call[1].exec.env?.['SENTINEL_ALLOWED_HOSTS']
      assert(typeof hosts === 'string', 'Expected an explicit Sentinel host allowlist')
      return hosts
    },
    setPresent: (value) => {
      present = value
    },
  }
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => {
    cleanup()
  })
  vi.restoreAllMocks()
})

describe('StartOS enabled interface addresses', () => {
  it('passes only SDK-enabled IPs and hostnames to Sentinel', async () => {
    const state = setupInterface(
      [
        publicAddress,
        { ...publicAddress, hostname: '203.0.113.43' },
        { ...publicAddress, hostname: '10.0.0.20', public: false },
        { ...publicAddress, hostname: 'fd00::20', public: false, metadata: { kind: 'ipv6' } },
        { ...publicAddress, hostname: 'node.local', public: false, metadata: { kind: 'mdns' } },
        { ...publicAddress, hostname: 'example.onion', metadata: { kind: 'plugin' } },
        { ...publicAddress, hostname: 'control.example.com', metadata: { kind: 'public-domain' } },
        { ...publicAddress, hostname: 'disabled.local', public: false, metadata: { kind: 'mdns' } },
      ],
      [`${publicIp}:50399`],
    )
    state.addresses.disabled.push(['disabled.local', 50399])

    await main(state.options)

    expect(state.allowedHosts().split(',')).toEqual([
      '10.0.0.20',
      publicIp,
      'control.example.com',
      'example.onion',
      'fd00::20',
      'node.local',
    ])
  })

  it('restarts with a changed allowlist when public access is enabled, then disabled', async () => {
    const state = setupInterface([publicAddress])
    await main(state.options)
    expect(state.allowedHosts()).toBe('')

    state.addresses.enabled.push(`${publicIp}:50399`)
    state.changed()
    await vi.waitFor(() => {
      expect(state.retry).toHaveBeenCalledTimes(1)
    })
    await main(state.options)
    expect(state.allowedHosts()).toBe(publicIp)

    state.addresses.enabled = []
    state.changed()
    await vi.waitFor(() => {
      expect(state.retry).toHaveBeenCalledTimes(2)
    })
    await main(state.options)
    expect(state.allowedHosts()).toBe('')
  })

  it('replaces an old public IP when the enabled address changes', async () => {
    const state = setupInterface([publicAddress], [`${publicIp}:50399`])
    await main(state.options)
    state.addresses.available = [{ ...publicAddress, hostname: '203.0.113.99' }]
    state.addresses.enabled = ['203.0.113.99:50399']
    state.changed()
    await vi.waitFor(() => {
      expect(state.retry).toHaveBeenCalledOnce()
    })
    await main(state.options)
    expect(state.allowedHosts()).toBe('203.0.113.99')
  })

  it('waits with an empty allowlist when the interface is missing, then reacts when it appears', async () => {
    const state = setupInterface([publicAddress], [`${publicIp}:50399`])
    state.setPresent(false)
    await main(state.options)
    expect(state.allowedHosts()).toBe('')
    state.setPresent(true)
    state.changed()
    await vi.waitFor(() => {
      expect(state.retry).toHaveBeenCalledOnce()
    })
    await main(state.options)
    expect(state.allowedHosts()).toBe(publicIp)
  })

  it('deduplicates multiple ports and ignores changes that leave allowed hostnames unchanged', async () => {
    const state = setupInterface([publicAddress], [`${publicIp}:50399`])
    await main(state.options)
    state.addresses.available.push({ ...publicAddress, port: 50400 })
    state.addresses.enabled.push(`${publicIp}:50400`)
    state.addresses.available.reverse()
    state.changed()
    // Flush the SDK's asynchronous subscription; no changed mapped value should trigger a retry.
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.retry).not.toHaveBeenCalled()
    await main(state.options)
    expect(state.allowedHosts()).toBe(publicIp)
  })
})

describe('StartOS entrypoint', () => {
  it.each([undefined, '', `${publicIp},fd00::20,example.onion`])('preserves the configured allowlist: %s', (hosts) => {
    const directory = mkdtempSync(join(tmpdir(), 'sentinel-interface-'))
    cleanups.push(() => {
      rmSync(directory, { recursive: true, force: true })
    })
    // Stub only external executables, so the actual shell entrypoint is exercised.
    writeFileSync(join(directory, 'yq'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    writeFileSync(join(directory, 'node'), '#!/bin/sh\nprintf "%s" "$SENTINEL_ALLOWED_HOSTS"\n', { mode: 0o755 })
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` }
    delete env.SENTINEL_ALLOWED_HOSTS
    if (hosts !== undefined) {
      env.SENTINEL_ALLOWED_HOSTS = hosts
    }
    const output = execFileSync('bash', [fileURLToPath(new URL('../docker_entrypoint.sh', import.meta.url))], {
      env,
      encoding: 'utf8',
    })
    expect(output).toBe(hosts ?? 'hoseki-sentinel.local,hoseki-sentinel.embassy,*.local,*.onion,*.embassy')
  })
})
