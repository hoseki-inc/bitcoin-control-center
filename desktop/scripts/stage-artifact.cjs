const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { extractFile } = require('@electron/asar')

const desktop = resolve(__dirname, '..')
const root = resolve(desktop, '..')
const target = process.argv[2]
if (target !== 'mac' && target !== 'win') throw new Error('Expected mac or win')
const version = execFileSync(process.execPath, [join(root, 'start9/scripts/version.mjs'), 'get'], {
  encoding: 'utf8',
}).trim()
const tag = execFileSync(process.execPath, [join(root, 'start9/scripts/version.mjs'), 'tag'], {
  encoding: 'utf8',
}).trim()
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const arch = target === 'mac' ? 'arm64' : 'x64'
const file = `Bitcoin-Control-Center-${tag}-${target}-${arch}.${target === 'mac' ? 'dmg' : 'exe'}`
const resources =
  target === 'mac'
    ? join(desktop, 'release/mac-arm64/Bitcoin Control Center.app/Contents/Resources')
    : join(desktop, 'release/win-unpacked/resources')
const metadata = JSON.parse(extractFile(join(resources, 'app.asar'), 'package.json').toString())
if (
  metadata.version !== version.split(':')[0] ||
  metadata.bccReleaseVersion !== version ||
  metadata.bccSourceCommit !== sourceCommit
) {
  throw new Error('Packaged application identity does not match the release source')
}
const sourceDirty = String(metadata.bccSourceDirty) !== 'false'
if (process.env.CI && sourceDirty) throw new Error('CI artifacts must come from a clean source revision')
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
  desktopVersion: metadata.version,
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
