import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { assembleDesktopRelease } from './assemble-desktop-release.mjs'
import { stageStartosRelease } from './stage-startos-release.mjs'

const packageFile = 'hoseki-sentinel-v0.2.3_1.s9pk'
const packageBytes = 'verified signed package'
const notes = 'Verified release notes.\n'

/**
 * @param {string | Buffer} bytes
 * @returns {string}
 */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bcc-stage-release-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const downloads = join(root, 'signed-artifact')
  const output = join(root, 'release')
  mkdirSync(downloads)
  writeFileSync(join(downloads, packageFile), packageBytes)
  writeFileSync(join(downloads, 'RELEASE_NOTES.md'), notes)
  const run = async () => stageStartosRelease(downloads, output, packageFile, sha256(packageBytes), sha256(notes))
  return { root, downloads, output, run }
}

test('excludes injected installers and checksum entries from the assembled release', async () => {
  const f = fixture()
  writeFileSync(join(f.downloads, 'Unexpected-Installer.exe'), 'unverified installer')
  writeFileSync(join(f.downloads, 'GITHUB_RELEASE_NOTES.md'), 'unverified instructions')
  writeFileSync(
    join(f.downloads, 'SHA256SUMS'),
    `${sha256('unverified installer')}  Unexpected-Installer.exe\n${sha256('other')}  ../other-file\n`,
  )
  await f.run()
  assert.deepEqual(readdirSync(f.output).sort(), ['RELEASE_NOTES.md', 'SHA256SUMS', packageFile].sort())
  assert.equal(readFileSync(join(f.output, 'RELEASE_NOTES.md'), 'utf8'), notes)
  assert.equal(readFileSync(join(f.output, 'SHA256SUMS'), 'utf8'), `${sha256(packageBytes)}  ${packageFile}\n`)

  // Exercise the next handoff too: both legitimate desktop builds enter staging, while the injected one does not.
  const desktop = join(f.root, 'desktop-artifacts')
  const sourceCommit = 'a'.repeat(40)
  for (const [platform, arch, ext] of [
    ['mac', 'arm64', 'dmg'],
    ['win', 'x64', 'exe'],
  ]) {
    const directory = join(desktop, `Bitcoin-Control-Center-${platform}-${arch}`)
    mkdirSync(directory, { recursive: true })
    const file = `Bitcoin-Control-Center-v0.2.3_1-${platform}-${arch}.${ext}`
    const bytes = `verified ${platform} installer`
    writeFileSync(join(directory, file), bytes)
    writeFileSync(
      join(directory, `${platform}.json`),
      JSON.stringify({
        platform,
        arch,
        releaseVersion: '0.2.3:1',
        desktopVersion: '0.2.3',
        tag: 'v0.2.3_1',
        sourceCommit,
        sourceDirty: false,
        file,
        sha256: sha256(bytes),
      }),
    )
  }
  assembleDesktopRelease(desktop, f.output, '0.2.3:1', sourceCommit)
  assert.deepEqual(
    readdirSync(f.output)
      .filter((file) => /\.(s9pk|dmg|exe)$/.test(file))
      .sort(),
    [
      'Bitcoin-Control-Center-v0.2.3_1-mac-arm64.dmg',
      'Bitcoin-Control-Center-v0.2.3_1-win-x64.exe',
      packageFile,
    ].sort(),
  )
  const checksums = readFileSync(join(f.output, 'SHA256SUMS'), 'utf8').trimEnd().split('\n')
  assert.equal(checksums.length, 4)
  for (const line of checksums) {
    const [digest, file] = line.split('  ')
    assert.equal(sha256(readFileSync(join(f.output, file))), digest)
  }
})

test.each([packageFile, 'RELEASE_NOTES.md'])('rejects altered %s before creating staging', async (file) => {
  const f = fixture()
  writeFileSync(join(f.downloads, file), 'altered')
  await assert.rejects(f.run, /do not match/)
  assert.equal(existsSync(f.output), false)
})

test('refuses an existing staging directory containing unverified files', async () => {
  const f = fixture()
  mkdirSync(f.output)
  writeFileSync(join(f.output, 'Unexpected-Installer.exe'), 'left over')
  await assert.rejects(f.run, /EEXIST/)
  assert.equal(existsSync(join(f.output, packageFile)), false)
})

test('rejects path traversal and missing trusted digests', async () => {
  const f = fixture()
  await assert.rejects(
    async () => stageStartosRelease(f.downloads, f.output, '../outside.s9pk', sha256(packageBytes), sha256(notes)),
    /package filename/,
  )
  await assert.rejects(
    async () => stageStartosRelease(f.downloads, f.output, packageFile, '', sha256(notes)),
    /signing job/,
  )
  assert.equal(existsSync(f.output), false)
})
