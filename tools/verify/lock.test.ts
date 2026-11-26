import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { describe, it } from 'vitest'
import { z } from 'zod'
import { type ProcessIdentity, withLock } from './lock'
import { type AsyncCommandResult, ChildEnv, runAsync } from './process'
import { REPO_ROOT, processIdentity, processStartTime } from './run'

async function inTemp(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'verify-lock-'))
  try {
    await fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const options = { identify: processIdentity }
const owner = (pid: number, startedAt: string, host = hostname()): string =>
  JSON.stringify({ pid, startedAt, hostname: host, token: 'someone-else' })

/** A held lock as another process left it: the directory and its owner.json. */
function plantLock(lockDir: string, ownerJson: string): void {
  mkdirSync(lockDir)
  writeFileSync(join(lockDir, 'owner.json'), ownerJson)
}

const OwnerFileSchema = z.object({ pid: z.number(), startedAt: z.string(), hostname: z.string(), token: z.string() })

function readOwnerFile(lockDir: string): z.infer<typeof OwnerFileSchema> {
  return parseUnknown(OwnerFileSchema, JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'))).expect(
    'owner.json',
  )
}

async function until(what: string, check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`)
    }
    await sleep(10)
  }
}

/**
 * One process in the handoff tests, run with tsx. `holder` takes the lock and keeps it until `a-release` appears.
 * `waiter` looks the holder up through a lookup that stalls until the successor holds the lock, as a slow `ps` can,
 * then answers truthfully. `successor` takes the lock and keeps it for a while. Each writes marker files to `dir`.
 */
const WORKER = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { withLock } from ${JSON.stringify(join(REPO_ROOT, 'tools/verify/lock.ts'))}
import { processIdentity, processStartTime } from ${JSON.stringify(join(REPO_ROOT, 'tools/verify/run.ts'))}
const [role, dir, lockDir] = process.argv.slice(2)
const mark = (name, value = {}) => writeFileSync(join(dir, name), JSON.stringify({ at: Date.now(), ...value }))
const stall = (pid) => {
  if (role === 'waiter' && pid === Number(readFileSync(join(dir, 'a-pid'), 'utf8'))) {
    mark('w-looking')
    const deadline = Date.now() + 20000
    while (!existsSync(join(dir, 'b-in')) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
}
// Both names, so the test can also run against a lock that takes a plain start-time lookup.
const options = {
  timeoutMs: 30000,
  identify: (pid) => { stall(pid); return processIdentity(pid) },
  startTime: (pid) => { stall(pid); return processStartTime(pid) },
}
if (role === 'holder') {
  writeFileSync(join(dir, 'a-pid'), String(process.pid))
  await withLock(lockDir, options, async () => {
    mark('a-in')
    while (!existsSync(join(dir, 'a-release'))) await sleep(10)
  })
} else if (role === 'waiter') {
  await withLock(lockDir, options, () => {
    mark('w-in', { successorHolding: existsSync(join(dir, 'b-in')) && !existsSync(join(dir, 'b-out')) })
  })
} else {
  await withLock(lockDir, options, async () => {
    mark('b-in')
    await sleep(1500)
    const ownerFile = join(lockDir, 'owner.json')
    const held = existsSync(ownerFile) ? JSON.parse(readFileSync(ownerFile, 'utf8')) : null
    mark('b-out', { stillOwner: held?.pid === process.pid })
  })
}
`

const MarkSchema = z.object({
  at: z.number(),
  successorHolding: z.boolean().optional(),
  stillOwner: z.boolean().optional(),
})

async function startWorker(root: string, role: string, lockDir: string): Promise<AsyncCommandResult> {
  const worker = join(root, 'worker.mts')
  if (!existsSync(worker)) {
    writeFileSync(worker, WORKER)
  }
  return runAsync(
    join(REPO_ROOT, 'node_modules/.bin/tsx'),
    ['--tsconfig', 'tools/verify/tsconfig.json', worker, role, root, lockDir],
    { cwd: REPO_ROOT, env: ChildEnv.with({ NODE_NO_WARNINGS: '1' }), timeoutMs: 60_000 },
  )
}

describe('withLock', () => {
  it('serializes async critical sections, so read-modify-write never loses an update', async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'counter.lock')
      const counter = join(root, 'counter.txt')
      writeFileSync(counter, '0')
      let inside = 0
      let maxInside = 0
      await Promise.all(
        Array.from({ length: 10 }, async (_, i) =>
          withLock(lockDir, options, async () => {
            inside += 1
            maxInside = Math.max(maxInside, inside)
            const value = Number(readFileSync(counter, 'utf8'))
            await sleep(i % 3)
            writeFileSync(counter, String(value + 1))
            inside -= 1
          }),
        ),
      )
      assert.equal(readFileSync(counter, 'utf8'), '10')
      assert.equal(maxInside, 1)
      assert.equal(existsSync(lockDir), false)
    })
  })

  it('never lets a waiter that judged an exited holder remove the lock its successor took meanwhile', async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      const marker = (name: string): z.infer<typeof MarkSchema> =>
        parseUnknown(MarkSchema, JSON.parse(readFileSync(join(root, name), 'utf8'))).expect(name)

      // 1. A holds the lock. 2. W waits, and its lookup of A stalls.
      const holder = startWorker(root, 'holder', lockDir)
      await until('the holder to take the lock', () => existsSync(join(root, 'a-in')))
      const waiter = startWorker(root, 'waiter', lockDir)
      await until('the waiter to look the holder up', () => existsSync(join(root, 'w-looking')))
      // 3. A releases and exits. 4. B takes the lock, which lets W's lookup answer that A has exited.
      writeFileSync(join(root, 'a-release'), '')
      assert.equal((await holder).code, 0)
      const [successor, waited] = await Promise.all([startWorker(root, 'successor', lockDir), waiter])
      assert.equal(successor.code, 0, successor.stderr)
      assert.equal(waited.code, 0, waited.stderr)

      const entered = marker('w-in')
      const successorOut = marker('b-out')
      assert.equal(successorOut.stillOwner, true, "the waiter removed the successor's lock")
      assert.equal(entered.successorHolding, false, 'the waiter entered while the successor held the lock')
      assert.ok(entered.at >= successorOut.at)
      assert.equal(existsSync(lockDir), false)
    })
  }, 90_000)

  it('keeps a live holder when the lookup fails, rather than taking a failure for an exit', async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      const holder = startWorker(root, 'holder', lockDir)
      try {
        await until('the holder to take the lock', () => existsSync(join(root, 'a-in')))
        const holderOwner = readOwnerFile(lockDir)
        const lookups: number[] = []
        const failing = (pid: number): ProcessIdentity => {
          lookups.push(pid)
          return pid === process.pid ? processIdentity(pid) : { state: 'unknown', detail: 'ps failed' }
        }
        let entered = false
        await assert.rejects(
          withLock(lockDir, { identify: failing, timeoutMs: 400 }, () => {
            entered = true
          }),
          new RegExp(`Timed out after 400 ms waiting for .*held by PID ${holderOwner.pid}`),
        )
        assert.equal(entered, false)
        assert.ok(lookups.includes(holderOwner.pid))
        assert.deepEqual(readOwnerFile(lockDir), holderOwner)
      } finally {
        writeFileSync(join(root, 'a-release'), '')
        assert.equal((await holder).code, 0)
      }
    })
  }, 60_000)

  it("keeps a live holder's lock when its owner.json can't be read, rather than taking it as abandoned", async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      const ownerFile = join(lockDir, 'owner.json')
      const holder = startWorker(root, 'holder', lockDir)
      try {
        await until('the holder to take the lock', () => existsSync(join(root, 'a-in')))
        const holderOwner = readOwnerFile(lockDir)
        // The holder's owner record is valid but unreadable for now, as a permissions or I/O error makes it.
        chmodSync(ownerFile, 0o000)
        let entered = false
        try {
          await assert.rejects(
            withLock(lockDir, { ...options, timeoutMs: 400 }, () => {
              entered = true
            }),
            /EACCES/,
          )
        } finally {
          chmodSync(ownerFile, 0o644)
        }
        assert.equal(entered, false)
        assert.deepEqual(readOwnerFile(lockDir), holderOwner)
      } finally {
        writeFileSync(join(root, 'a-release'), '')
        assert.equal((await holder).code, 0)
      }
      assert.equal(existsSync(lockDir), false)
    })
  }, 60_000)

  it('writes its owner while held and releases the lock when the holder throws', async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      await assert.rejects(
        withLock(lockDir, options, () => {
          const held = readOwnerFile(lockDir)
          assert.equal(held.pid, process.pid)
          assert.equal(held.hostname, hostname())
          assert.equal(held.startedAt, processStartTime(process.pid))
          throw new Error('boom')
        }),
        /boom/,
      )
      assert.equal(existsSync(lockDir), false)
      assert.equal(await withLock(lockDir, options, () => 'again'), 'again')
    })
  })

  it('waits for a live holder and times out naming it', async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      // This test process is alive, so its own PID and start time make a live owner.
      plantLock(lockDir, owner(process.pid, processStartTime(process.pid) ?? ''))
      let ran = false
      await assert.rejects(
        withLock(lockDir, { ...options, timeoutMs: 150 }, () => {
          ran = true
        }),
        new RegExp(`Timed out after 150 ms waiting for .*held by PID ${process.pid}`),
      )
      assert.equal(ran, false)
      assert.equal(readOwnerFile(lockDir).token, 'someone-else')
    })
  })

  it('reclaims a lock whose holder exited, or whose PID now belongs to a later process', async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      // The PID runs, but not as the process that took the lock: it was reused.
      plantLock(lockDir, owner(process.pid, 'Mon Jan  1 00:00:00 2001'))
      assert.equal(await withLock(lockDir, { ...options, timeoutMs: 1_000 }, () => 'reused'), 'reused')

      plantLock(lockDir, owner(2_147_483_000, 'never'))
      assert.equal(await withLock(lockDir, { ...options, timeoutMs: 1_000 }, () => 'exited'), 'exited')
      assert.equal(existsSync(lockDir), false)
    })
  })

  it('clears a lock left without a readable owner, which only a taker dying midway leaves', async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      mkdirSync(lockDir)
      assert.equal(await withLock(lockDir, { ...options, timeoutMs: 1_000 }, () => 'ownerless'), 'ownerless')
      plantLock(lockDir, '{"pid": ')
      assert.equal(await withLock(lockDir, { ...options, timeoutMs: 1_000 }, () => 'garbled'), 'garbled')
    })
  })

  it("waits for another machine's holder instead of judging a PID it can't check", async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      plantLock(lockDir, owner(2_147_483_000, 'never', `${hostname()}-elsewhere`))
      await assert.rejects(
        withLock(lockDir, { ...options, timeoutMs: 100 }, () => 'no'),
        /Timed out/,
      )
      assert.equal(existsSync(lockDir), true)
    })
  })

  it('never removes a lock that another holder took over while this one ran', async () => {
    await inTemp(async (root) => {
      const lockDir = join(root, 'run.lock')
      await withLock(lockDir, options, () => {
        writeFileSync(join(lockDir, 'owner.json'), owner(process.pid, 'someone else'))
      })
      assert.equal(readOwnerFile(lockDir).token, 'someone-else')
    })
  })
})

describe('processIdentity', () => {
  it('reads a running PID with the start time ps reports, and an absent PID as exited', () => {
    assert.deepEqual(processIdentity(process.pid), { state: 'running', startedAt: processStartTime(process.pid) })
    assert.deepEqual(processIdentity(2_147_483_000), { state: 'exited' })
  })
})
