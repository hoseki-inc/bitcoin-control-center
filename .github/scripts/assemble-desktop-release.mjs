// Adds both verified desktop installers to a staged StartOS release, after checking each one
// was built for this exact release version and source commit.
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BUILDS = [
  { platform: 'mac', arch: 'arm64', ext: 'dmg' },
  { platform: 'win', arch: 'x64', ext: 'exe' },
]

/**
 * Reads one field of a build report, failing if it's missing.
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function field(value, key) {
  if (!(value instanceof Object) || !Object.hasOwn(value, key)) {
    throw new Error(`Desktop build report is missing ${key}`)
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

/** @param {string | Buffer} bytes */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Validates both native builds before adding them to the staged StartOS release.
 * @param {string} downloads Directory holding the downloaded Bitcoin-Control-Center-<platform>-<arch> artifacts.
 * @param {string} output Release staging directory, already holding the StartOS SHA256SUMS.
 * @param {string} version Release version, such as 0.2.6:0.
 * @param {string} sourceCommit Full source commit the release is built from.
 * @returns {void}
 */
export function assembleDesktopRelease(downloads, output, version, sourceCommit) {
  if (!/^\d+\.\d+\.\d+:\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('Expected a protected release version and exact source commit')
  }
  const tag = `v${version.replace(':', '_')}`
  // Every build is checked before anything is copied, so a mismatch never leaves half a release.
  const builds = BUILDS.map(({ platform, arch, ext }) => {
    const directory = join(downloads, `Bitcoin-Control-Center-${platform}-${arch}`)
    /** @type {unknown} */
    const report = JSON.parse(readFileSync(join(directory, `${platform}.json`), 'utf8'))
    const file = `Bitcoin-Control-Center-${tag}-${platform}-${arch}.${ext}`
    if (
      field(report, 'platform') !== platform ||
      field(report, 'arch') !== arch ||
      field(report, 'releaseVersion') !== version ||
      field(report, 'desktopVersion') !== version.split(':')[0] ||
      field(report, 'tag') !== tag ||
      field(report, 'sourceCommit') !== sourceCommit ||
      field(report, 'sourceDirty') !== false ||
      field(report, 'file') !== file
    ) {
      throw new Error(`Desktop ${platform} build identity does not match the release`)
    }
    const source = join(directory, file)
    const checksum = sha256(readFileSync(source))
    if (field(report, 'sha256') !== checksum) {
      throw new Error(`Desktop ${platform} checksum mismatch`)
    }
    return { report, source, file, checksum }
  })

  // Keep the already-verified StartOS package checksum alongside the desktop assets.
  const checksums = readFileSync(join(output, 'SHA256SUMS'), 'utf8').trimEnd().split('\n')
  for (const { source, file, checksum } of builds) {
    copyFileSync(source, join(output, file))
    checksums.push(`${checksum}  ${file}`)
  }
  const metadata = `${JSON.stringify(
    builds.map(({ report }) => report),
    null,
    2,
  )}\n`
  writeFileSync(join(output, 'DESKTOP_BUILDS.json'), metadata)
  checksums.push(`${sha256(metadata)}  DESKTOP_BUILDS.json`)
  writeFileSync(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const [downloads, output, version, sourceCommit] = process.argv.slice(2)
  if (downloads === undefined || output === undefined || version === undefined || sourceCommit === undefined) {
    throw new Error('Usage: assemble-desktop-release.mjs <downloads> <output> <version> <source commit>')
  }
  assembleDesktopRelease(downloads, output, version, sourceCommit)
}
