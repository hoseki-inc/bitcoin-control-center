const { createHash } = require('node:crypto')
const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Validate both native builds before adding them to the staged StartOS release.
 * @param {string} downloads
 * @param {string} output
 * @param {string} version
 * @param {string} sourceCommit
 * @returns {void}
 */
function assembleDesktopRelease(downloads, output, version, sourceCommit) {
  if (!/^\d+\.\d+\.\d+:\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('Expected a protected release version and exact source commit')
  }
  const tag = `v${version.replace(':', '_')}`
  const builds = [
    { platform: 'mac', arch: 'arm64', ext: 'dmg' },
    { platform: 'win', arch: 'x64', ext: 'exe' },
  ].map(({ platform, arch, ext }) => {
    const directory = join(downloads, `desktop-${platform}-${arch}`)
    const report = JSON.parse(readFileSync(join(directory, `${platform}.json`), 'utf8'))
    const file = `Bitcoin-Control-Center-${tag}-${platform}-${arch}.${ext}`
    if (
      report.platform !== platform ||
      report.arch !== arch ||
      report.releaseVersion !== version ||
      report.desktopVersion !== version.split(':')[0] ||
      report.tag !== tag ||
      report.sourceCommit !== sourceCommit ||
      report.sourceDirty !== false ||
      report.file !== file
    ) {
      throw new Error(`Desktop ${platform} build identity does not match the release`)
    }
    const source = join(directory, file)
    const sha256 = createHash('sha256').update(readFileSync(source)).digest('hex')
    if (report.sha256 !== sha256) throw new Error(`Desktop ${platform} checksum mismatch`)
    return { report, source }
  })

  // Keep the already-verified StartOS package checksum alongside the desktop assets.
  const checksums = readFileSync(join(output, 'SHA256SUMS'), 'utf8').trimEnd().split('\n')
  mkdirSync(output, { recursive: true })
  for (const { report, source } of builds) {
    copyFileSync(source, join(output, report.file))
    checksums.push(`${report.sha256}  ${report.file}`)
  }
  const metadata = `${JSON.stringify(
    builds.map(({ report }) => report),
    null,
    2,
  )}\n`
  writeFileSync(join(output, 'DESKTOP_BUILDS.json'), metadata)
  checksums.push(`${createHash('sha256').update(metadata).digest('hex')}  DESKTOP_BUILDS.json`)
  writeFileSync(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
}

module.exports = { assembleDesktopRelease }
if (require.main === module) assembleDesktopRelease(...process.argv.slice(2))
