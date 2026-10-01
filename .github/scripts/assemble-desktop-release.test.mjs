import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { assembleDesktopRelease } from './assemble-desktop-release.mjs'

const version = '0.2.3:1'
const sourceCommit = 'a'.repeat(40)

/**
 * @typedef {{ platform: string, arch: string, releaseVersion: string, desktopVersion: string, tag: string,
 *   sourceCommit: string, sourceDirty: boolean, file: string, sha256: string }} Report
 * @typedef {{ report: Report, manifest: string, directory: string, installer: string }} Build
 */

/**
 * Writes one synthetic installer and its build report, as the desktop workflow uploads them.
 * @param {string} downloads
 * @param {string} platform
 * @param {string} arch
 * @param {string} ext
 * @returns {Build}
 */
function build(downloads, platform, arch, ext) {
  const directory = join(downloads, `Bitcoin-Control-Center-${platform}-${arch}`)
  mkdirSync(directory, { recursive: true })
  const file = `Bitcoin-Control-Center-v0.2.3_1-${platform}-${arch}.${ext}`
  const bytes = Buffer.from(`synthetic ${platform} installer`)
  const report = {
    platform,
    arch,
    releaseVersion: version,
    desktopVersion: '0.2.3',
    tag: 'v0.2.3_1',
    sourceCommit,
    sourceDirty: false,
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const installer = join(directory, file)
  writeFileSync(installer, bytes)
  const manifest = join(directory, `${platform}.json`)
  writeFileSync(manifest, JSON.stringify(report))
  return { report, manifest, directory, installer }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bcc-release-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const downloads = join(root, 'downloads')
  const output = join(root, 'output')
  mkdirSync(output)
  writeFileSync(join(output, 'SHA256SUMS'), 'startos-checksum  hoseki-sentinel-v0.2.3_1.s9pk\n')
  const mac = build(downloads, 'mac', 'arm64', 'dmg')
  const win = build(downloads, 'win', 'x64', 'exe')
  const run = () => {
    assembleDesktopRelease(downloads, output, version, sourceCommit)
  }
  return { downloads, output, mac, win, run }
}

test('assembles both matching native builds and retains the StartOS checksum', () => {
  const f = fixture()
  f.run()
  const sums = readFileSync(join(f.output, 'SHA256SUMS'), 'utf8')
  assert.match(sums, /^startos-checksum {2}hoseki-sentinel-v0\.2\.3_1\.s9pk\n/)
  for (const { report } of [f.mac, f.win]) {
    assert.ok(existsSync(join(f.output, report.file)))
    assert.ok(sums.includes(`${report.sha256}  ${report.file}\n`))
  }
  const metadata = readFileSync(join(f.output, 'DESKTOP_BUILDS.json'))
  /** @type {unknown} */
  const builds = JSON.parse(metadata.toString())
  assert.ok(Array.isArray(builds))
  assert.equal(builds.length, 2)
  assert.ok(sums.includes(`${createHash('sha256').update(metadata).digest('hex')}  DESKTOP_BUILDS.json\n`))
})

test('rejects a mismatched source commit before staging either installer', () => {
  const f = fixture()
  writeFileSync(f.win.manifest, JSON.stringify({ ...f.win.report, sourceCommit: 'b'.repeat(40) }))
  assert.throws(f.run, /identity/)
  assert.equal(existsSync(join(f.output, f.mac.report.file)), false)
})

test('rejects dirty sources and filenames outside the expected artifact path', () => {
  const f = fixture()
  for (const changes of [{ sourceDirty: true }, { file: '../unexpected.dmg' }]) {
    writeFileSync(f.mac.manifest, JSON.stringify({ ...f.mac.report, ...changes }))
    assert.throws(f.run, /identity/)
  }
})

test.each([
  { platform: 'linux' },
  { arch: 'x64' },
  { tag: 'v0.2.3_0' },
  { desktopVersion: '0.2.4' },
  { sourceDirty: 'false' },
  { sourceDirty: undefined },
])('rejects a build whose identity field differs: %j', (changes) => {
  const f = fixture()
  writeFileSync(f.mac.manifest, JSON.stringify({ ...f.mac.report, ...changes }))
  assert.throws(f.run, /identity|missing/)
  assert.equal(existsSync(join(f.output, f.mac.report.file)), false)
})

test.each([
  { version: '0.2.3', commit: sourceCommit },
  { version: 'v0.2.3:1', commit: sourceCommit },
  { version, commit: 'a'.repeat(12) },
])('rejects a malformed release version or source commit: $version $commit', ({ version: badVersion, commit }) => {
  const f = fixture()
  assert.throws(() => {
    assembleDesktopRelease(f.downloads, f.output, badVersion, commit)
  }, /protected release version/)
})

test('rejects altered or missing installer bytes', () => {
  const f = fixture()
  writeFileSync(f.win.installer, 'altered')
  assert.throws(f.run, /checksum/)
  rmSync(f.win.installer)
  assert.throws(f.run, /ENOENT/)
})

test('requires both platforms at the exact packaging revision', () => {
  const f = fixture()
  writeFileSync(f.win.manifest, JSON.stringify({ ...f.win.report, releaseVersion: '0.2.3:0' }))
  assert.throws(f.run, /identity/)
  rmSync(f.win.directory, { recursive: true })
  assert.throws(f.run, /ENOENT/)
  assert.equal(existsSync(join(f.output, f.mac.report.file)), false)
})
