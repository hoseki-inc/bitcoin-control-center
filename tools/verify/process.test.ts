import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { describe, it, vi } from 'vitest'
import {
  ChildEnv,
  callerDockerSelection,
  dockerChildEnv,
  dockerChildEnvFor,
  runCommandResult,
  verifyHelperEnv,
} from './process'

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
      'BCC_VERIFY_CACHE_DIR',
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

describe('Docker environments', () => {
  it('pins Docker calls to the recorded endpoint and config, whatever the caller selects now', () => {
    try {
      vi.stubEnv('DOCKER_HOST', 'unix:///caller.sock')
      vi.stubEnv('DOCKER_CONTEXT', 'local-b')
      vi.stubEnv('DOCKER_CONFIG', '/caller-config')
      vi.stubEnv('SENTINEL_PIN', 'secret')

      const pinned = dockerChildEnvFor({
        endpoint: 'unix:///owner.sock',
        context: 'local-a',
        dockerConfig: '/owner',
      }).vars
      assert.equal(pinned['DOCKER_HOST'], 'unix:///owner.sock')
      assert.equal(pinned['DOCKER_CONFIG'], '/owner')
      assert.equal('DOCKER_CONTEXT' in pinned, false)
      assert.equal('SENTINEL_PIN' in pinned, false)

      // A record made with the default config keeps it, rather than taking the caller's.
      const defaultConfig = dockerChildEnvFor({ endpoint: 'unix:///owner.sock' }).vars
      assert.equal('DOCKER_CONFIG' in defaultConfig, false)

      const byContext = dockerChildEnvFor({ context: 'local-a' }).vars
      assert.equal(byContext['DOCKER_CONTEXT'], 'local-a')
      assert.equal('DOCKER_HOST' in byContext, false)

      assert.deepEqual(dockerChildEnvFor({}).vars, dockerChildEnv().vars)
      // A record naming only its config keeps that config with the caller's other settings.
      const configOnly = dockerChildEnvFor({ dockerConfig: '/owner' }).vars
      assert.equal(configOnly['DOCKER_CONFIG'], '/owner')
      assert.equal(configOnly['DOCKER_HOST'], 'unix:///caller.sock')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("reads the caller's Docker selection, ignoring empty values as the Docker CLI does", () => {
    try {
      vi.stubEnv('DOCKER_HOST', '  ')
      vi.stubEnv('DOCKER_CONTEXT', ' colima ')
      vi.stubEnv('DOCKER_CONFIG', '')
      assert.deepEqual(callerDockerSelection(), { context: 'colima' })
      vi.stubEnv('DOCKER_HOST', 'unix:///custom.sock')
      vi.stubEnv('DOCKER_CONFIG', '/cfg')
      assert.deepEqual(callerDockerSelection(), { host: 'unix:///custom.sock', context: 'colima', config: '/cfg' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('gives nested helper calls the cache root and Docker selection, and nothing else from the caller', () => {
    try {
      vi.stubEnv('BCC_VERIFY_CACHE_DIR', '/cache-root')
      vi.stubEnv('DOCKER_HOST', 'unix:///tmp/colima.sock')
      vi.stubEnv('DOCKER_CONTEXT', 'colima')
      vi.stubEnv('DOCKER_CONFIG', '/tmp/colima-config')
      vi.stubEnv('SENTINEL_PIN', 'secret')
      vi.stubEnv('GIT_DIR', '/elsewhere')
      vi.stubEnv('PATH', '/caller/bin')
      const { vars } = verifyHelperEnv()
      assert.equal(vars['BCC_VERIFY_CACHE_DIR'], '/cache-root')
      assert.equal(vars['DOCKER_HOST'], 'unix:///tmp/colima.sock')
      assert.equal(vars['DOCKER_CONTEXT'], 'colima')
      assert.equal(vars['DOCKER_CONFIG'], '/tmp/colima-config')
      assert.equal(vars['PATH'], '/caller/bin')
      assert.equal(vars['TMPDIR'], tmpdir())
      assert.equal('SENTINEL_PIN' in vars, false)
      assert.equal('GIT_DIR' in vars, false)
      // Sentinel, fakes and apps still start from the base allowlist.
      assert.equal('BCC_VERIFY_CACHE_DIR' in ChildEnv.with().vars, false)
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
