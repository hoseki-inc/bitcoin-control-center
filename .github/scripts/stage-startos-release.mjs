// Rebuild release staging from the two files authenticated by the signing job's outputs.
// Downloaded archives and their checksum lists never decide which files enter a release.
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) {
    if (!Buffer.isBuffer(chunk)) {
      throw new Error('Expected binary file contents while hashing the signed artifact')
    }
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * Copies only the verified package and notes into a new staging directory.
 * @param {string} downloads Directory containing the signed artifact's extracted files.
 * @param {string} output A staging directory that must not already exist.
 * @param {string} packageFile Exact package filename supplied by the caller.
 * @param {string} expectedSha256 Package digest from the signing job's outputs.
 * @param {string} expectedNotesSha256 Notes digest from the signing job's outputs.
 * @returns {Promise<void>}
 */
export async function stageStartosRelease(downloads, output, packageFile, expectedSha256, expectedNotesSha256) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.s9pk$/.test(packageFile)) {
    throw new Error('Expected a package filename within the downloaded artifact')
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !/^[a-f0-9]{64}$/.test(expectedNotesSha256)) {
    throw new Error('Expected package and release notes digests from the signing job')
  }
  const sourcePackage = join(downloads, packageFile)
  const sourceNotes = join(downloads, 'RELEASE_NOTES.md')
  const [packageDigest, notesDigest] = await Promise.all([sha256(sourcePackage), sha256(sourceNotes)])
  if (packageDigest !== expectedSha256 || notesDigest !== expectedNotesSha256) {
    throw new Error('The StartOS package or release notes do not match the signing job')
  }

  // Refuse an existing directory so files from a prior step can never survive staging.
  mkdirSync(output)
  copyFileSync(sourcePackage, join(output, packageFile))
  copyFileSync(sourceNotes, join(output, 'RELEASE_NOTES.md'))
  writeFileSync(join(output, 'SHA256SUMS'), `${expectedSha256}  ${packageFile}\n`)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const [downloads, output, packageFile, expectedSha256, expectedNotesSha256] = process.argv.slice(2)
  if (
    downloads === undefined ||
    output === undefined ||
    packageFile === undefined ||
    expectedSha256 === undefined ||
    expectedNotesSha256 === undefined
  ) {
    throw new Error(
      'Usage: stage-startos-release.mjs <downloads> <output> <package filename> <package sha256> <notes sha256>',
    )
  }
  await stageStartosRelease(downloads, output, packageFile, expectedSha256, expectedNotesSha256)
}
