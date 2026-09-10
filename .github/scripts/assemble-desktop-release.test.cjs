const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const { assembleDesktopRelease } = require('./assemble-desktop-release.cjs')

const version = '0.2.3:1'
const sourceCommit = 'a'.repeat(40)

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bcc-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const downloads = join(root, 'downloads')
  const output = join(root, 'output')
  mkdirSync(output)
  writeFileSync(join(output, 'SHA256SUMS'), 'startos-checksum  hoseki-sentinel-v0.2.3_1.s9pk\n')
  const reports = {}
  for (const [platform, arch, ext] of [
    ['mac', 'arm64', 'dmg'],
    ['win', 'x64', 'exe'],
  ]) {
    const directory = join(downloads, `desktop-${platform}-${arch}`)
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
    writeFileSync(join(directory, file), bytes)
    const manifest = join(directory, `${platform}.json`)
    writeFileSync(manifest, JSON.stringify(report))
    reports[platform] = { report, manifest, directory, file: join(directory, file) }
  }
  return { downloads, output, reports, run: () => assembleDesktopRelease(downloads, output, version, sourceCommit) }
}

test('assembles both matching native builds and retains the StartOS checksum', (t) => {
  const f = fixture(t)
  f.run()
  const sums = readFileSync(join(f.output, 'SHA256SUMS'), 'utf8')
  assert.match(sums, /^startos-checksum  hoseki-sentinel-v0\.2\.3_1\.s9pk\n/)
  for (const { report } of Object.values(f.reports)) {
    assert.ok(existsSync(join(f.output, report.file)))
    assert.ok(sums.includes(`${report.sha256}  ${report.file}\n`))
  }
  const metadata = readFileSync(join(f.output, 'DESKTOP_BUILDS.json'))
  assert.equal(JSON.parse(metadata).length, 2)
  assert.ok(sums.includes(`${createHash('sha256').update(metadata).digest('hex')}  DESKTOP_BUILDS.json\n`))
})

test('rejects a mismatched source commit before staging either installer', (t) => {
  const f = fixture(t)
  const win = f.reports.win
  writeFileSync(win.manifest, JSON.stringify({ ...win.report, sourceCommit: 'b'.repeat(40) }))
  assert.throws(f.run, /identity/)
  assert.equal(existsSync(join(f.output, f.reports.mac.report.file)), false)
})

test('rejects dirty sources and filenames outside the expected artifact path', (t) => {
  const f = fixture(t)
  const mac = f.reports.mac
  for (const changes of [{ sourceDirty: true }, { file: '../unexpected.dmg' }]) {
    writeFileSync(mac.manifest, JSON.stringify({ ...mac.report, ...changes }))
    assert.throws(f.run, /identity/)
  }
})

test('rejects altered or missing installer bytes', (t) => {
  const f = fixture(t)
  writeFileSync(f.reports.win.file, 'altered')
  assert.throws(f.run, /checksum/)
  rmSync(f.reports.win.file)
  assert.throws(f.run, /ENOENT/)
})

test('requires both platforms at the exact packaging revision', (t) => {
  const f = fixture(t)
  const win = f.reports.win
  writeFileSync(win.manifest, JSON.stringify({ ...win.report, releaseVersion: '0.2.3:0' }))
  assert.throws(f.run, /identity/)
  rmSync(win.directory, { recursive: true })
  assert.throws(f.run, /ENOENT/)
  assert.equal(existsSync(join(f.output, f.reports.mac.report.file)), false)
})
