import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const levels = ['info', 'low', 'moderate', 'high', 'critical']
const auditLevel = process.argv[2]?.replace(/^--audit-level=/, '') ?? 'moderate'
if (process.argv.length > 3 || !levels.includes(auditLevel)) {
  throw new Error('Usage: security:audit [--audit-level=info|low|moderate|high|critical]')
}

// When invoked by pnpm, reuse that installed CLI rather than a different global version.
const packageManager = process.env.npm_execpath
const useCurrentPnpm = packageManager !== undefined && /^pnpm\.(?:c?js)$/.test(basename(packageManager))
const rootCommand = useCurrentPnpm ? process.execPath : 'pnpm'
const rootArguments = useCurrentPnpm ? [packageManager] : []
const graphs = [
  { name: 'root', lockfile: 'pnpm-lock.yaml', command: rootCommand, args: [...rootArguments, 'audit'] },
  { name: 'desktop', lockfile: 'desktop/package-lock.json', command: 'npm', args: ['--prefix', 'desktop', 'audit'] },
  { name: 'start9', lockfile: 'start9/package-lock.json', command: 'npm', args: ['--prefix', 'start9', 'audit'] },
  {
    name: 'start9-runtime',
    lockfile: 'start9/runtime/package-lock.json',
    command: 'npm',
    args: ['--prefix', 'start9/runtime', 'audit'],
  },
]
const output = mkdtempSync(join(tmpdir(), 'bcc-audit-'))
console.log(`Audit output: ${output}`)
const environment = { ...process.env }
delete environment.NODE_ENV
delete environment.NPM_CONFIG_OMIT
delete environment.npm_config_omit
delete environment.NPM_CONFIG_PRODUCTION
delete environment.npm_config_production
Object.assign(environment, {
  COREPACK_ENABLE_NETWORK: '0',
  npm_config_manage_package_manager_versions: 'false',
  npm_config_ignore_scripts: 'true',
  npm_config_include: 'dev',
  npm_config_update_notifier: 'false',
  npm_config_cache: join(output, 'npm-cache'),
  npm_config_fetch_retries: '0',
  npm_config_fetch_timeout: '20000',
})

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function field(value, key) {
  if (!(value instanceof Object) || !Object.hasOwn(value, key)) {
    return undefined
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

/**
 * @param {string} stdout
 * @param {number | null} exitStatus
 * @returns {{status: string, counts?: Record<string, number>, reason?: string}}
 */
function classify(stdout, exitStatus) {
  try {
    /** @type {unknown} */
    const report = JSON.parse(stdout)
    if (
      field(report, 'error') !== undefined ||
      (!(field(report, 'advisories') instanceof Object) && !(field(report, 'vulnerabilities') instanceof Object))
    ) {
      throw new Error('Missing audit findings or registry error')
    }
    const summary = field(field(report, 'metadata'), 'vulnerabilities')
    const counts = Object.fromEntries(
      levels.map((level) => {
        const count = field(summary, level)
        if (!Number.isSafeInteger(count) || Number(count) < 0) {
          throw new Error('Missing or invalid severity counts')
        }
        return [level, Number(count)]
      }),
    )
    const aboveThreshold = levels.slice(levels.indexOf(auditLevel)).some((level) => counts[level] > 0)
    if (exitStatus !== (aboveThreshold ? 1 : 0)) {
      throw new Error('Unexpected exit status or summary/exit mismatch')
    }
    return {
      status: Object.values(counts).some((count) => count > 0)
        ? 'completed with findings'
        : 'completed with no known findings',
      counts,
    }
  } catch (error) {
    return { status: 'incomplete/error', reason: error instanceof Error ? error.message : 'Invalid audit output' }
  }
}

let exitCode = 0
const scans = []
for (const graph of graphs) {
  const args = [...graph.args, `--audit-level=${auditLevel}`, '--json']
  const startedAt = new Date().toISOString()
  const result = spawnSync(graph.command, args, {
    cwd: resolve(import.meta.dirname, '../..'),
    env: environment,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  writeFileSync(join(output, `${graph.name}.stdout.json`), stdout)
  writeFileSync(join(output, `${graph.name}.stderr.txt`), stderr)
  writeFileSync(join(output, `${graph.name}.exit.txt`), `${result.status ?? 'unavailable'}\n`)
  const classification = result.error
    ? { status: 'incomplete/error', reason: result.error.message }
    : classify(stdout, result.status)
  const scan = {
    ...graph,
    args,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitStatus: result.status,
    signal: result.signal,
    ...classification,
  }
  scans.push(scan)
  writeFileSync(join(output, `${graph.name}.status.json`), `${JSON.stringify(scan, null, 2)}\n`)
  console.log(`${graph.lockfile}: ${scan.status} (exit ${scan.exitStatus ?? 'unavailable'})`)
  if (classification.status === 'incomplete/error') {
    exitCode = 2
  } else if (result.status === 1 && exitCode === 0) {
    exitCode = 1
  }
}
writeFileSync(join(output, 'summary.json'), `${JSON.stringify({ auditLevel, exitCode, scans }, null, 2)}\n`)
process.exitCode = exitCode
