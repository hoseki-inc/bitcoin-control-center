// Copies a built installer into desktop/release/artifacts/<target>/ with its build metadata
// and checksum, after checking the packaged app carries the release version and source commit.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import asar from '@electron/asar'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..')
const target = process.argv[2]
if (target !== 'mac' && target !== 'win') {
  throw new Error('Expected mac or win')
}

/** @param {string} command */
function releaseVersion(command) {
  return execFileSync(process.execPath, [join(root, 'start9/scripts/version.mjs'), command], {
    encoding: 'utf8',
  }).trim()
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function field(value, key) {
  if (!(value instanceof Object) || !Object.hasOwn(value, key)) {
    throw new Error(`Packaged package.json is missing ${key}`)
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

const version = releaseVersion('get')
const tag = releaseVersion('tag')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const arch = target === 'mac' ? 'arm64' : 'x64'
const file = `Bitcoin-Control-Center-${tag}-${target}-${arch}.${target === 'mac' ? 'dmg' : 'exe'}`
const resources =
  target === 'mac'
    ? join(desktop, 'release/mac-arm64/Bitcoin Control Center.app/Contents/Resources')
    : join(desktop, 'release/win-unpacked/resources')
/** @type {unknown} */
const metadata = JSON.parse(asar.extractFile(join(resources, 'app.asar'), 'package.json').toString())
if (
  field(metadata, 'version') !== version.split(':')[0] ||
  field(metadata, 'bccReleaseVersion') !== version ||
  field(metadata, 'bccSourceCommit') !== sourceCommit
) {
  throw new Error('Packaged application identity does not match the release source')
}
// electron-builder writes the flag as text or a boolean; anything but false counts as dirty.
const sourceDirty = String(field(metadata, 'bccSourceDirty')) !== 'false'
if (process.env['CI'] !== undefined && sourceDirty) {
  throw new Error('CI artifacts must come from a clean source revision')
}
const output = join(desktop, 'release/artifacts', target)
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
copyFileSync(join(desktop, 'release', file), join(output, file))
const sha256 = createHash('sha256')
  .update(readFileSync(join(output, file)))
  .digest('hex')
const report = {
  platform: target,
  arch,
  releaseVersion: version,
  desktopVersion: field(metadata, 'version'),
  tag,
  sourceCommit,
  sourceDirty,
  file,
  sha256,
  signing: target === 'mac' ? 'ad-hoc; not notarized' : 'no publisher signing configured',
}
writeFileSync(join(output, `${target}.json`), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(join(output, 'SHA256SUMS'), `${sha256}  ${file}\n`)
console.log(`Staged ${file} from ${sourceCommit.slice(0, 12)}${sourceDirty ? ' (local changes)' : ''}`)
