import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { describe, it, vi } from 'vitest'
import { ChildEnv } from './process'

describe('ChildEnv', () => {
  it('passes only allowlisted variables from the caller, plus the ones set on purpose', () => {
    const names = ['GIT_DIR', 'GIT_WORK_TREE', 'VITE_BACKEND_API_URL', 'TZ', 'SENTINEL_PIN'] as const
    try {
      for (const name of names) {
        vi.stubEnv(name, 'from the caller')
      }
      vi.stubEnv('PATH', '/caller/bin')
      const { vars } = ChildEnv.with({ TZ: 'UTC' })
      assert.equal(vars['PATH'], '/caller/bin')
      assert.equal(vars['TZ'], 'UTC')
      assert.deepEqual(
        names.filter((name) => name !== 'TZ' && name in vars),
        [],
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('ChildEnv type', () => {
  it('can only be built by ChildEnv.with', () => {
    // @ts-expect-error A plain object with the same shape is not a ChildEnv.
    const forged: ChildEnv = { vars: { GIT_DIR: '/elsewhere' } }
    assert.equal(forged instanceof ChildEnv, false)
  })

  it("gives every child the parent's own temp folder", () => {
    assert.equal(ChildEnv.with().vars['TMPDIR'], tmpdir())
  })
})
