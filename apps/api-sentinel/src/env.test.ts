import { describe, expect, it, vi } from 'vitest'
import type { Env } from './env'

async function loadEnvWith(values: Record<string, string | undefined>): Promise<Env> {
  vi.resetModules()
  vi.stubEnv('ELECTRUM_HOST', 'electrum.local')
  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(name, value)
  }
  try {
    const { loadEnv } = await import('./env')
    return loadEnv()
  } finally {
    vi.unstubAllEnvs()
  }
}

describe('loadEnv', () => {
  it('keeps IP-address hosts off and waits for Electrum unless a package opts in', async () => {
    const env = await loadEnvWith({ SENTINEL_ALLOW_IP_HOSTS: undefined, SENTINEL_WAIT_FOR_ELECTRUM: undefined })

    expect(env.SENTINEL_ALLOW_IP_HOSTS).toBe(false)
    expect(env.SENTINEL_WAIT_FOR_ELECTRUM).toBe(true)
  })

  it('reads the package options', async () => {
    const env = await loadEnvWith({ SENTINEL_ALLOW_IP_HOSTS: 'true', SENTINEL_WAIT_FOR_ELECTRUM: 'false' })

    expect(env.SENTINEL_ALLOW_IP_HOSTS).toBe(true)
    expect(env.SENTINEL_WAIT_FOR_ELECTRUM).toBe(false)
  })

  it('refuses values other than true and false', async () => {
    await expect(loadEnvWith({ SENTINEL_ALLOW_IP_HOSTS: 'TRUE' })).rejects.toThrow('SENTINEL_ALLOW_IP_HOSTS')
    await expect(loadEnvWith({ SENTINEL_WAIT_FOR_ELECTRUM: '0' })).rejects.toThrow('SENTINEL_WAIT_FOR_ELECTRUM')
  })
})
