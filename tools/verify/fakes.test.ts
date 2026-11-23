import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { describe, it } from 'vitest'
import { z } from 'zod'
import { ChildEnv, runToLog, startGroup } from './process'
import { FakesRecordSchema, HELPER, REPO_ROOT, readJsonFile, wait } from './run'

// Starts the real fakes in a temp folder and drives `helpers/verify fault` against them, as a recipe would.

const RUN = 'fault-test'

const AnswerSchema = z.object({ result: z.unknown().optional(), error: z.unknown().optional() })
type Answer = z.infer<typeof AnswerSchema>

const ReleasePayloadSchema = z.object({ tag: z.string() })

interface Fakes {
  fault: (target: string, mode: string) => string
  /** One Electrum request on a new connection: the answer, or the connection error's code. */
  electrum: (method: string, params?: readonly unknown[]) => Promise<Answer | string>
  /** The HTTP status, or the connection error's code. */
  mempool: (path: string) => Promise<number | string>
  mempoolJson: (path: string) => Promise<{ status: number; body: unknown }>
  requestLog: () => string
}

async function withFakes(test: (fakes: Fakes) => Promise<void>, extraArgs: readonly string[] = []): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'verify-fakes-'))
  const env = ChildEnv.with({ TMPDIR: dir })
  // run.ts names the checkout's folder under bcc-verify by a hash, and this temp folder holds only it.
  const runDir = (): string => {
    const root = join(dir, 'bcc-verify')
    return join(root, (existsSync(root) ? readdirSync(root)[0] : undefined) ?? 'missing', RUN)
  }
  const log = openSync(join(dir, 'fakes.log'), 'w')
  const leader =
    startGroup(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      ['--tsconfig', 'tools/verify/tsconfig.json', 'tools/verify/fakes.ts', '--run', RUN, ...extraArgs],
      { cwd: REPO_ROOT, env, log },
    ).pid ?? 0
  try {
    let ports = { electrumPort: 0, mempoolPort: 0 }
    for (let tries = 0; ports.electrumPort === 0; tries++) {
      assert.ok(tries < 200, 'The fakes did not start')
      const found = readJsonFile(FakesRecordSchema, join(runDir(), 'fakes.json'))
      ports = found.status === 'ok' ? found.value : ports
      await wait(100)
    }
    await test({
      fault: (target, mode) => {
        const out = join(dir, 'fault.log')
        const faultLog = openSync(out, 'w')
        try {
          runToLog(join(REPO_ROOT, HELPER), ['fault', '--run', RUN, target, mode], {
            cwd: REPO_ROOT,
            env,
            log: faultLog,
          })
        } finally {
          closeSync(faultLog)
        }
        return readFileSync(out, 'utf8')
      },
      electrum: async (method, params = []) =>
        new Promise((done) => {
          const socket = connect(ports.electrumPort, '127.0.0.1')
          let buffer = ''
          socket.on('error', (error: NodeJS.ErrnoException) => {
            done(error.code ?? error.message)
          })
          socket.on('data', (chunk) => {
            buffer += chunk.toString()
            if (buffer.includes('\n')) {
              socket.destroy()
              done(parseUnknown(AnswerSchema, JSON.parse(buffer)).unwrapOr({}))
            }
          })
          socket.write(`${JSON.stringify({ id: 1, method, params })}\n`)
        }),
      mempool: async (path) => {
        try {
          return (await fetch(`http://127.0.0.1:${ports.mempoolPort}${path}`)).status
        } catch (error) {
          return error instanceof Error && error.cause instanceof Error && 'code' in error.cause
            ? String(error.cause.code)
            : 'failed'
        }
      },
      mempoolJson: async (path) => {
        const response = await fetch(`http://127.0.0.1:${ports.mempoolPort}${path}`)
        return { status: response.status, body: await response.json() }
      },
      requestLog: () => readFileSync(join(runDir(), 'logs', 'fake-requests.log'), 'utf8'),
    })
  } finally {
    closeSync(log)
    process.kill(-leader, 'SIGTERM')
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('helpers/verify fault', { timeout: 60_000 }, () => {
  it('fails mempool requests with a server error, then restores them', async () => {
    await withFakes(async ({ fault, mempool, requestLog }) => {
      assert.equal(await mempool('/api/v1/prices'), 200)
      assert.match(fault('mempool', 'error'), /Faults now: mempool error\./)
      assert.equal(await mempool('/api/v1/prices'), 500)
      assert.match(fault('mempool', 'ok'), /The fakes behave normally\./)
      assert.equal(await mempool('/api/v1/prices'), 200)
      // FAULT, not ERROR: the doctor's fake coverage check counts only requests the fakes couldn't serve.
      assert.match(requestLog(), /mempool GET \/api\/v1\/prices 500 FAULT error/)
      assert.doesNotMatch(requestLog(), / ERROR|UNHANDLED/)
    })
  })

  it('refuses connections while a fake is down, and listens again on the same port', async () => {
    await withFakes(async ({ fault, electrum, mempool }) => {
      assert.equal(await mempool('/api/v1/prices'), 200)
      fault('mempool', 'down')
      // A client's pooled keep-alive connection is dropped (ECONNRESET); new ones are refused.
      assert.match(String(await mempool('/api/v1/prices')), /^ECONN(RESET|REFUSED)$/)
      assert.equal(await mempool('/api/v1/prices'), 'ECONNREFUSED')
      fault('electrum', 'down')
      assert.equal(await electrum('server.ping'), 'ECONNREFUSED')
      fault('electrum', 'ok')
      fault('mempool', 'ok')
      assert.deepEqual(await electrum('server.ping'), { result: null })
      assert.equal(await mempool('/api/v1/prices'), 200)
    })
  })

  it("keeps Electrum's keepalives answering while every data request fails", async () => {
    await withFakes(async ({ fault, electrum, requestLog }) => {
      const history = ['blockchain.scripthash.get_history', ['00'.repeat(32)]] as const
      fault('electrum', 'error')
      assert.deepEqual(await electrum('server.ping'), { result: null })
      assert.deepEqual(await electrum(...history), {
        error: { code: -32603, message: 'Verify fault: the server failed this request' },
      })
      fault('electrum', 'ok')
      assert.deepEqual(await electrum(...history), { result: [] })
      assert.match(requestLog(), /electrum blockchain\.scripthash\.get_history FAULT error/)
    })
  })

  it('refuses an unknown target or mode', async () => {
    await withFakes(async ({ fault }) => {
      assert.throws(() => fault('price', 'down'))
      assert.throws(() => fault('electrum', 'broken'))
    })
  })

  it('serves /latest.json with the configured release tag and default when omitted', async () => {
    await withFakes(async ({ mempoolJson }) => {
      const { status, body } = await mempoolJson('/latest.json')
      assert.equal(status, 200)
      assert.deepEqual(parseUnknown(ReleasePayloadSchema, body).unwrap(), { tag: 'v0.0.0_0' })
    })

    await withFakes(
      async ({ mempoolJson }) => {
        const { status, body } = await mempoolJson('/latest.json')
        assert.equal(status, 200)
        assert.deepEqual(parseUnknown(ReleasePayloadSchema, body).unwrap(), { tag: 'v99.0.0_0' })
      },
      ['--release-tag', 'v99.0.0_0'],
    )
  })
})
