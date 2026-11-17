import assert from 'node:assert/strict'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { ChildEnv, runToLog } from './process'
import { HELPER, REPO_ROOT } from './run'

interface HelperResult {
  output: string
  failed: boolean
}

/** Runs the helper as an agent would and returns what it printed and whether it failed. */
function helper(args: string[], extra: Readonly<Record<string, string>> = {}): HelperResult {
  const dir = mkdtempSync(join(tmpdir(), 'verify-helper-'))
  const log = openSync(join(dir, 'out.log'), 'w')
  let failed = false
  try {
    // Runs live under the temp folder, so the helper gets this test's own: it can never touch a real run.
    runToLog(join(REPO_ROOT, HELPER), args, { cwd: REPO_ROOT, env: ChildEnv.with({ TMPDIR: dir, ...extra }), log })
  } catch {
    failed = true
  } finally {
    closeSync(log)
  }
  const output = readFileSync(join(dir, 'out.log'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return { output, failed }
}

describe('helpers/verify', () => {
  it("uses the caller's TMP when TMPDIR isn't set, as Node does", () => {
    const tmp = mkdtempSync(join(tmpdir(), 'verify-tmp-'))
    try {
      const { output } = helper(['cleanup', '--run', 'no-such-run'], { TMPDIR: '', TMP: tmp })
      assert.match(output, new RegExp(`Removed ${tmp}/bcc-verify/`))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("starts the scripts without the caller's NODE_OPTIONS or proxy settings", () => {
    const { output } = helper(['query', '--run', 'no-such-run', '--sql', 'SELECT 1'], {
      NODE_OPTIONS: '--require /no-such-hook.js',
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: 'http://127.0.0.1:9',
    })
    assert.doesNotMatch(output, /no-such-hook/)
  })

  it('refuses a flag without its value instead of picking a run', () => {
    const { output, failed } = helper(['cleanup', '--run'])
    assert.equal(failed, true)
    assert.match(output, /argument missing/)
  })

  it('refuses a retired or unknown flag', () => {
    const { output, failed } = helper(['evidence', 'record', 'statements', '--sub', 'listed', '--run', 'no-such-run'])
    assert.equal(failed, true)
    assert.match(output, /Unknown option '--sub'/)
  })

  it('reads --run=ID as that run', () => {
    const { output } = helper(['doctor', '--run=no-such-run'])
    assert.match(output, /no-such-run/)
  })
})
