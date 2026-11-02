// Release 3's dependency audit. It fails on any moderate or worse advisory that isn't skipped
// below, and on a skip whose advisory no longer appears, so skips don't outlive their reason.
// npm audit can't ignore an advisory, so the skips live here rather than in pnpm.auditConfig.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Each skip is tracked in https://github.com/hoseki-inc/bitcoin-control-center/issues/383,
// with why it's safe for now and what clears it.
const skipped = new Map([
  ['GHSA-mrhx-c7xc-m3w5', 'zod, until the workspace moves to Zod 4'],
  ['GHSA-g3hv-75wg-m249', 'minimatch, until our dependencies move to minimatch 11'],
  ['GHSA-3g3m-2fjr-6pw4', 'glob, until our dependencies move to glob 14'],
])

const blockingSeverities = new Set(['moderate', 'high', 'critical'])
const root = fileURLToPath(new URL('../..', import.meta.url))
// Run the pnpm that started `pnpm security:audit`, which may be Corepack's rather than one on PATH.
const pnpm =
  process.env.npm_execpath?.includes('pnpm') === true ? [process.execPath, process.env.npm_execpath] : ['pnpm']

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function field(value, key) {
  return value instanceof Object ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function values(value) {
  return value instanceof Object ? Object.values(value).map((item) => /** @type {unknown} */ (item)) : []
}

/**
 * Both tools exit non-zero whenever they find anything, so read the report whatever the status.
 * @param {string} name
 * @param {string[]} command
 * @returns {unknown}
 */
function report(name, [file, ...args]) {
  const { stdout, stderr, error } = spawnSync(file ?? '', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (error !== undefined) {
    throw new Error(`${name} audit could not run: ${error.message}`)
  }
  /** @type {unknown} */
  const parsed = stdout === '' ? undefined : JSON.parse(stdout)
  if (!(field(parsed, 'advisories') instanceof Object) && !(field(parsed, 'vulnerabilities') instanceof Object)) {
    throw new Error(`${name} audit returned no report: ${stderr}`)
  }
  return parsed
}

/** @type {{ name: string, advisories: unknown[] }[]} */
const projects = [
  { name: 'root', advisories: values(field(report('root', [...pnpm, 'audit', '--json']), 'advisories')) },
  ...['desktop', 'start9', 'start9/runtime'].map((prefix) => ({
    name: prefix,
    // npm lists each vulnerable package; an advisory object in `via` is the advisory itself,
    // while a string names another package whose own entry lists it.
    advisories: values(field(report(prefix, ['npm', '--prefix', prefix, 'audit', '--json']), 'vulnerabilities'))
      .flatMap((vulnerability) => values(field(vulnerability, 'via')))
      .filter((advisory) => advisory instanceof Object),
  })),
]

/** @type {Set<string>} */
const seen = new Set()
/** @type {string[]} */
const blocking = []

for (const { name, advisories } of projects) {
  /** @type {Set<string>} */
  const reported = new Set()
  for (const advisory of advisories) {
    const url = String(field(advisory, 'url'))
    const ghsa = url.split('/').at(-1) ?? url
    const severity = String(field(advisory, 'severity'))
    seen.add(ghsa)
    if (blockingSeverities.has(severity) && !skipped.has(ghsa) && !reported.has(ghsa)) {
      reported.add(ghsa)
      const module = String(field(advisory, 'module_name') ?? field(advisory, 'name'))
      blocking.push(`${name}: ${severity} ${module}: ${String(field(advisory, 'title'))} (${url})`)
    }
  }
}

const stale = [...skipped].filter(([ghsa]) => !seen.has(ghsa))

for (const [ghsa, reason] of skipped) {
  if (seen.has(ghsa)) {
    console.log(`Skipped ${ghsa} (${reason})`)
  }
}
if (blocking.length > 0) {
  console.error(`Moderate or worse advisories:\n${blocking.map((line) => `  ${line}`).join('\n')}`)
}
if (stale.length > 0) {
  console.error(
    `No longer reported, so remove these skips from .github/scripts/security-audit.mjs and check them off issue 383:\n${stale.map(([ghsa, reason]) => `  ${ghsa} (${reason})`).join('\n')}`,
  )
}
if (blocking.length > 0 || stale.length > 0) {
  process.exitCode = 1
} else {
  console.log('No moderate or worse advisories outside the skips')
}
