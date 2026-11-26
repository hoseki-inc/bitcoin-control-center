import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result'
import { encodeHwAppBtcSignature } from '@hoseki/packages/ui/wallet-ui/ledger/ledger-utils'
import LedgerBtcApp from '@ledgerhq/hw-app-btc'
import { pathStringToArray } from '@ledgerhq/hw-app-btc/lib/bip32'
import { AppClient } from '@ledgerhq/hw-app-btc/lib/newops/appClient'
import Transport from '@ledgerhq/hw-transport'
import { Verifier } from 'bip322-js'
import { describe, it } from 'vitest'
import { z } from 'zod'
import { EMULATOR_PRIMARY } from '../emulator-seeds'
import { emulatorTestsEnabled, runAsync, verifyHelperEnv } from '../process'
import {
  EVIDENCE_ROOT,
  HELPER,
  REPO_ROOT,
  type RunState,
  dockerDaemonProblem,
  readRunState,
  reportsOnlyAbsence,
  runDocker,
  runPaths,
  writeJson,
} from '../run'

// Opt-in: BCC_VERIFY_EMULATOR_TESTS=1 pnpm exec vitest run --root tools/verify. Builds or reuses the cached ELFs,
// starts real Speculos on Docker for each model through the CLI, and drives Ledger's own hw-app-btc against it.

const ApduAnswerSchema = z.object({ data: z.string() })

/** hw-app-btc over the Speculos REST API, one APDU at a time. */
class SpeculosTransport extends Transport {
  private readonly baseUrl: string

  public constructor(baseUrl: string) {
    super()
    this.baseUrl = baseUrl
  }

  public override async exchange(apdu: Buffer): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/apdu`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: apdu.toString('hex') }),
    })
    const answer = parseUnknown(ApduAnswerSchema, await response.json())
    if (answer.isErr()) {
      throw new Error(`Speculos /apdu answered HTTP ${response.status} without data`)
    }
    return Buffer.from(answer.unwrap().data, 'hex')
  }
}

async function helper(dir: string, args: string[]): Promise<{ output: string; failed: boolean }> {
  const result = await runAsync(join(REPO_ROOT, HELPER), args, {
    cwd: REPO_ROOT,
    // The caller's cache and Docker settings, as helpers/verify forwards them, with this test's own temp folder.
    env: verifyHelperEnv({ TMPDIR: dir }),
    timeoutMs: 600_000,
  })
  return { output: `${result.stdout}${result.stderr}`, failed: result.code !== 0 }
}

const MESSAGE =
  'I, the owner, affirm sole control of this account. No other third-party claims/access permitted. Ownership revocable solely by me. ID=emulator-3b'

describe.runIf(emulatorTestsEnabled())('Ledger on Speculos (BCC_VERIFY_EMULATOR_TESTS=1)', () => {
  it.each(['flex', 'nanosp'] as const)(
    'starts %s through the CLI, matches every xpub, signs and rejects on the device, then cleans up',
    async (model) => {
      const dir = mkdtempSync(join(tmpdir(), 'verify-speculos-'))
      const runId = `itest-${model}-${Math.random().toString(36).slice(2, 8)}`
      // The helper gets `dir` as its temp folder, so the run lives there, as helper.test.ts lays it out.
      const runDir = join(dir, 'bcc-verify', createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 8), runId)
      try {
        mkdirSync(runDir, { recursive: true })
        const state: RunState = {
          runId,
          launchedAt: new Date().toISOString(),
          fresh: false,
          desktop: false,
          electron: false,
          setupPinInUi: false,
          pin: false,
          build: { commit: 'abc', tree: 't', dirty: false },
          url: 'http://127.0.0.1:9',
          sentinel: { name: 'sentinel', pid: 999_999, startedAt: 'never', port: 9 },
          fakes: { name: 'fakes', pid: 999_998, startedAt: 'never', electrumPort: 10, mempoolPort: 11 },
        }
        writeJson(join(runDir, 'run.json'), state)

        const start = await helper(dir, ['emulator', 'start', '--device', 'ledger', '--model', model, '--run', runId])
        assert.equal(start.failed, false, start.output)
        assert.match(start.output, new RegExp(`Ledger ${model} is ready`))
        const recorded = readRunState({ ...runPaths(runId), stateFile: join(runDir, 'run.json') })
        const emulator = recorded.status === 'ok' ? recorded.value.emulators?.[0] : undefined
        assert.ok(emulator !== undefined)
        const status = await helper(dir, ['emulator', 'status', '--run', runId])
        assert.match(status.output, /\(running\) .* screen=idle/)

        const transport = new SpeculosTransport(`http://127.0.0.1:${emulator.apiPort}`)
        const btc = new LedgerBtcApp({ transport })
        const xpubs = {
          "m/44'/0'/0'": EMULATOR_PRIMARY.accounts.legacy.xpub,
          "m/49'/0'/0'": EMULATOR_PRIMARY.accounts.nestedSegwit.xpub,
          "m/84'/0'/0'": EMULATOR_PRIMARY.accounts.nativeSegwit.xpub,
          "m/86'/0'/0'": EMULATOR_PRIMARY.accounts.taproot.xpub,
          "m/48'/0'/0'/2'": EMULATOR_PRIMARY.multisigXpub,
        }
        for (const [path, expected] of Object.entries(xpubs)) {
          assert.equal(await btc.getWalletXpub({ path, xpubVersion: 0x0488b21e }), expected.toString(), path)
        }

        // Approve a real Sentinel-style challenge with `emulator press`, and check Sentinel's verifier accepts it.
        for (const [path, address] of [
          ["m/84'/0'/0'/0/0", 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'],
          ["m/44'/0'/0'/0/0", '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA'],
        ] as const) {
          const signing = btc.signMessage(path, Buffer.from(MESSAGE).toString('hex'))
          const press = await helper(dir, ['emulator', 'press', '--device', 'ledger', '--run', runId])
          assert.equal(press.failed, false, press.output)
          const signature = encodeHwAppBtcSignature(await signing)
          assert.equal(Verifier.verifySignature(address, MESSAGE, signature, false), true, path)
        }

        // A public key shown on the device, approved, then the same prompt rejected on the device.
        const client = new AppClient(transport)
        const shown = client.getExtendedPubkey(true, pathStringToArray("m/48'/0'/0'/2'"))
        assert.equal((await helper(dir, ['emulator', 'press', '--device', 'ledger', '--run', runId])).failed, false)
        assert.equal(await shown, EMULATOR_PRIMARY.multisigXpub.toString())
        for (const prompt of [
          async (): Promise<string> => client.getExtendedPubkey(true, pathStringToArray("m/48'/0'/0'/2'")),
          async (): Promise<object> => btc.signMessage("m/84'/0'/0'/0/0", Buffer.from(MESSAGE).toString('hex')),
        ]) {
          // The firmware's own refusal: SW 0x6985, which hw-app-btc reports as status code 27013.
          const refused = assert.rejects(prompt(), { statusCode: 0x6985 })
          const reject = await helper(dir, ['emulator', 'reject', '--device', 'ledger', '--run', runId])
          assert.equal(reject.failed, false, reject.output)
          await refused
        }

        // Nothing waits on the device now: press refuses instead of arming a decision.
        const idle = await helper(dir, ['emulator', 'press', '--device', 'ledger', '--run', runId])
        assert.equal(idle.failed, true)
        assert.match(idle.output, /no prompt appeared/)

        const shot = await helper(dir, ['emulator', 'screenshot', '--device', 'ledger', '--run', runId])
        assert.equal(shot.failed, false, shot.output)
        const file = join(EVIDENCE_ROOT, runId, '01-ledger-screen.png')
        assert.equal(shot.output.trim(), file)
        assert.deepEqual([...readFileSync(file).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

        const stop = await helper(dir, ['emulator', 'stop', '--device', 'ledger', '--run', runId])
        assert.equal(stop.failed, false, stop.output)
        // Gone from the daemon that ran it: that daemon answers, and reports only this ID absent, not merely exited.
        assert.ok(emulator.daemon !== undefined)
        assert.equal(dockerDaemonProblem(emulator.daemon), null)
        const absent = runDocker(['inspect', '--type', 'container', '--', emulator.containerId], emulator.daemon)
        assert.equal(reportsOnlyAbsence(absent.stderr, emulator.containerId), true, absent.stderr)
        const cleanup = await helper(dir, ['cleanup', '--run', runId])
        assert.equal(cleanup.failed, false, cleanup.output)
        assert.equal(existsSync(runDir), false)
      } finally {
        // On a failure, cleanup removes what the run recorded. If it can't, the run and its journal stay for a look.
        const teardown = await helper(dir, ['cleanup', '--run', runId])
        rmSync(join(EVIDENCE_ROOT, runId), { recursive: true, force: true })
        if (teardown.failed) {
          console.error(`Kept ${dir}: cleanup of ${runId} failed:\n${teardown.output}`)
        } else {
          rmSync(dir, { recursive: true, force: true })
        }
      }
    },
    600_000,
  )
})
