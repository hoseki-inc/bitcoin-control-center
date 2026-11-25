import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { describe, it, vi } from 'vitest'
import { ChildEnv, dockerChildEnv, runCommandResult } from './process'

describe('ChildEnv', () => {
  it('passes only allowlisted variables from the caller, plus the ones set on purpose', () => {
    const names = [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'VITE_BACKEND_API_URL',
      'TZ',
      'SENTINEL_PIN',
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG',
    ] as const
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

  it('forwards DOCKER_HOST, DOCKER_CONTEXT, and DOCKER_CONFIG only via dockerChildEnv', () => {
    try {
      vi.stubEnv('DOCKER_HOST', 'unix:///tmp/custom-docker.sock')
      vi.stubEnv('DOCKER_CONTEXT', 'colima')
      vi.stubEnv('DOCKER_CONFIG', '/tmp/custom-docker-config')
      vi.stubEnv('SENTINEL_PIN', 'secret')
      const { vars } = dockerChildEnv()
      assert.equal(vars['DOCKER_HOST'], 'unix:///tmp/custom-docker.sock')
      assert.equal(vars['DOCKER_CONTEXT'], 'colima')
      assert.equal(vars['DOCKER_CONFIG'], '/tmp/custom-docker-config')
      assert.equal('SENTINEL_PIN' in vars, false)
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

describe('runCommandResult', () => {
  it('captures stdout, stderr, and exit status without throwing', () => {
    const result = runCommandResult(
      process.execPath,
      ['-e', 'process.stdout.write("out"); process.stderr.write("err-detail"); process.exit(7)'],
      { env: ChildEnv.with() },
    )
    assert.equal(result.status, 7)
    assert.equal(result.stdout, 'out')
    assert.equal(result.stderr, 'err-detail')
    assert.equal(result.error, null)
  })
})
