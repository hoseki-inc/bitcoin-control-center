import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { onTestFinished, test } from 'vitest'

const fakeAudit = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const name = args.includes('--prefix') ? args[1] : 'root'
fs.appendFileSync(process.env.BCC_AUDIT_CALLS, JSON.stringify([name, ...args]) + '\\n')
const mode = process.env.BCC_AUDIT_CASE
if (name === 'root' && mode === 'network') {
  console.error('Synthetic registry failure')
  console.log(JSON.stringify({error: {code: 'ECONNRESET'}}))
  process.exit(1)
}
if (name === 'root' && mode === 'invalid-json') {
  console.log('Registry unavailable')
  process.exit(0)
}
const counts = {info: 0, low: 0, moderate: 0, high: 0, critical: 0}
if (name === 'root' && mode === 'low') counts.low = 1
if (name === 'desktop' && mode === 'npm-low') counts.low = 1
if ((name === 'root' && mode === 'findings') || (name === 'desktop' && mode === 'network')) counts.high = 1
console.log(JSON.stringify({vulnerabilities: {}, metadata: {vulnerabilities: counts}}))
if (name === 'root' && mode === 'bad-exit') process.exit(7)
if (name === 'root') process.exit(Object.values(counts).some(count => count > 0) ? 1 : 0)
process.exit(counts.high || (counts.low && args.includes('--audit-level=low')) ? 1 : 0)
`

/**
 * Runs the real CLI with fake registry commands, without making network requests.
 * @param {string} scenario
 * @param {string} level
 */
function fixture(scenario, level) {
  const root = mkdtempSync(join(tmpdir(), 'bcc-audit-test-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const bin = join(root, 'bin')
  mkdirSync(bin)
  for (const command of ['pnpm', 'npm']) {
    writeFileSync(join(bin, command), fakeAudit, { mode: 0o755 })
  }
  const callsFile = join(root, 'calls.jsonl')
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'audit-lockfiles.mjs'), level], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      npm_execpath: '',
      BCC_AUDIT_CALLS: callsFile,
      BCC_AUDIT_CASE: scenario,
    },
    timeout: 20_000,
  })
  assert.equal(result.error, undefined)
  const output = result.stdout.split('\n')[0].replace('Audit output: ', '')
  onTestFinished(() => {
    rmSync(output, { recursive: true, force: true })
  })
  /** @type {unknown} */
  const calls = readFileSync(callsFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      /** @type {unknown} */
      const call = JSON.parse(line)
      return call
    })
  assert.deepEqual(calls, [
    ['root', 'audit', level, '--json'],
    ['desktop', '--prefix', 'desktop', 'audit', level, '--json'],
    ['start9', '--prefix', 'start9', 'audit', level, '--json'],
    ['start9/runtime', '--prefix', 'start9/runtime', 'audit', level, '--json'],
  ])
  for (const name of ['root', 'desktop', 'start9', 'start9-runtime']) {
    assert.ok(readFileSync(join(output, `${name}.stdout.json`), 'utf8').length > 0)
    assert.ok(readFileSync(join(output, `${name}.exit.txt`), 'utf8').length > 0)
    readFileSync(join(output, `${name}.stderr.txt`), 'utf8')
  }
  return { result, output }
}

test.each([
  ['findings', '--audit-level=moderate', 1, 'completed with findings'],
  ['network', '--audit-level=moderate', 2, 'incomplete/error'],
  ['invalid-json', '--audit-level=moderate', 2, 'incomplete/error'],
  ['bad-exit', '--audit-level=moderate', 2, 'incomplete/error'],
  ['low', '--audit-level=moderate', 0, 'completed with findings'],
  ['low', '--audit-level=low', 1, 'completed with findings'],
  ['npm-low', '--audit-level=moderate', 0, 'completed with no known findings'],
  ['npm-low', '--audit-level=low', 1, 'completed with no known findings'],
  ['clean', '--audit-level=low', 0, 'completed with no known findings'],
])('runs every graph and reports %s at %s', (scenario, level, expectedExit, expectedStatus) => {
  const { result, output } = fixture(scenario, level)
  assert.equal(result.status, expectedExit)
  assert.ok(result.stdout.includes(`pnpm-lock.yaml: ${expectedStatus}`))
  if (scenario === 'network') {
    assert.match(readFileSync(join(output, 'root.stderr.txt'), 'utf8'), /Synthetic registry failure/)
    assert.ok(result.stdout.includes('desktop/package-lock.json: completed with findings'))
  }
})
