#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const start9Dir = dirname(scriptDir)
const versionsDir = join(start9Dir, 'startos', 'versions')
const indexPath = join(versionsDir, 'index.ts')
const currentPath = join(versionsDir, 'current.ts')

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+):(\d+)$/
const RELEASE_NOTES_PLACEHOLDER_MARKER = 'STARTOS_RELEASE_NOTES_REQUIRED'
const EMPTY_MIGRATIONS_RE = /migrations:\s*\{\s*\}/

function usage() {
  console.log(`Usage:
  node start9/scripts/version.mjs get
  node start9/scripts/version.mjs tag
  node start9/scripts/version.mjs check
  node start9/scripts/version.mjs assert-tag <vmajor.minor.patch_revision>
  node start9/scripts/version.mjs bump <major|minor|patch|revision> [--notes "Release notes"]
  node start9/scripts/version.mjs set <major.minor.patch:revision> [--notes "Release notes"]

Examples:
  node start9/scripts/version.mjs tag
  node start9/scripts/version.mjs assert-tag v0.2.1_0
  node start9/scripts/version.mjs bump patch
  node start9/scripts/version.mjs bump revision --notes "Packaging-only rebuild."
  node start9/scripts/version.mjs set 0.2.0:0 --notes "Adds portfolio history repair."
`)
}

/** @param {string} version */
function parseVersion(version) {
  const match = VERSION_RE.exec(version)
  if (!match) {
    throw new Error(`Invalid StartOS version "${version}". Expected major.minor.patch:revision, like 0.1.1:0.`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    revision: Number(match[4]),
  }
}

/** @param {ReturnType<typeof parseVersion>} version */
function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}:${version.revision}`
}

/**
 * Historical files follow Start9's naming: v0.6.0_1.ts exporting v_0_6_0_1.
 * @param {string} version
 */
function historicalNameForVersion(version) {
  const parsed = parseVersion(version)
  return {
    file: `v${parsed.major}.${parsed.minor}.${parsed.patch}_${parsed.revision}`,
    exportName: `v_${parsed.major}_${parsed.minor}_${parsed.patch}_${parsed.revision}`,
  }
}

/** @param {string} version */
function tagNameForVersion(version) {
  const parsed = parseVersion(version)
  return `v${parsed.major}.${parsed.minor}.${parsed.patch}_${parsed.revision}`
}

function readIndexSource() {
  return readFileSync(indexPath, 'utf8')
}

function readCurrentSource() {
  if (!existsSync(currentPath)) {
    throw new Error(`StartOS current version file ${currentPath} is missing.`)
  }
  return readFileSync(currentPath, 'utf8')
}

/** @param {string} source @param {string} path */
function readVersionFromSource(source, path) {
  const match = /version:\s*'([^']+)'/.exec(source)
  if (!match) {
    throw new Error(`Could not find version string in ${path}.`)
  }
  return match[1]
}

/** Historical version exports listed in the graph's `other` array. */
function readOtherExportNames() {
  const match = /other:\s*\[([^\]]*)\]/m.exec(readIndexSource())
  if (!match) {
    throw new Error(`Could not find the other array in ${indexPath}.`)
  }
  return match[1].split(/[,\s]+/).filter((part) => /^v_\d+_\d+_\d+_\d+$/.test(part))
}

function currentVersion() {
  return readVersionFromSource(readCurrentSource(), currentPath)
}

/**
 * @param {string} current
 * @param {string} bumpType
 */
function bumpVersion(current, bumpType) {
  const parsed = parseVersion(current)

  switch (bumpType) {
    case 'major':
      return formatVersion({ major: parsed.major + 1, minor: 0, patch: 0, revision: 0 })
    case 'minor':
      return formatVersion({ major: parsed.major, minor: parsed.minor + 1, patch: 0, revision: 0 })
    case 'patch':
    case 'bugfix':
      return formatVersion({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1, revision: 0 })
    case 'revision':
    case 'package':
    case 'packaging':
      return formatVersion({
        major: parsed.major,
        minor: parsed.minor,
        patch: parsed.patch,
        revision: parsed.revision + 1,
      })
    default:
      throw new Error(`Unknown bump "${bumpType}". Use major, minor, patch, or revision.`)
  }
}

/**
 * @param {string} left
 * @param {string} right
 */
function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (const key of ['major', 'minor', 'patch', 'revision']) {
    if (a[key] > b[key]) {
      return 1
    }
    if (a[key] < b[key]) {
      return -1
    }
  }
  return 0
}

function validateVersionGraph() {
  const source = readIndexSource()
  if (!source.includes("import { current } from './current'") || !source.includes('current,')) {
    throw new Error(`${indexPath} must import current from ./current and use it as the graph's current version.`)
  }

  const current = currentVersion()
  parseVersion(current)
  if (!/export const current\s*=/.test(readCurrentSource())) {
    throw new Error(`${currentPath} must export current.`)
  }

  // Start9 keeps earlier versions only while a later release migrates from them.
  const others = readOtherExportNames().map((exportName) => {
    const importMatch = new RegExp(`import \\{ ${exportName} \\} from '\\./(v[^']+)'`).exec(source)
    if (!importMatch) {
      throw new Error(`Version graph references ${exportName} without importing it.`)
    }
    const path = join(versionsDir, `${importMatch[1]}.ts`)
    if (!existsSync(path)) {
      throw new Error(`Version graph references missing file ${path}.`)
    }
    const fileSource = readFileSync(path, 'utf8')
    const version = readVersionFromSource(fileSource, path)
    const expected = historicalNameForVersion(version)
    if (expected.file !== importMatch[1] || expected.exportName !== exportName) {
      throw new Error(`${path} declares ${version}; expected ${expected.file}.ts exporting ${expected.exportName}.`)
    }
    if (!new RegExp(`export const ${exportName}\\s*=`).test(fileSource)) {
      throw new Error(`${path} must export ${exportName}.`)
    }
    if (compareVersions(current, version) <= 0) {
      throw new Error(`Historical version ${version} must be lower than current version ${current}.`)
    }
    return { file: importMatch[1], source: fileSource }
  })

  const referencedFiles = new Set(['current', 'index', ...others.map(({ file }) => file)])
  const unreferencedFiles = readdirSync(versionsDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.slice(0, -3))
    .filter((name) => !referencedFiles.has(name))
  if (unreferencedFiles.length > 0) {
    throw new Error(`StartOS version files are not referenced by the graph: ${unreferencedFiles.join(', ')}.`)
  }

  if (
    [readCurrentSource(), ...others.map(({ source: fileSource }) => fileSource)].some((fileSource) =>
      fileSource.includes(RELEASE_NOTES_PLACEHOLDER_MARKER),
    ) &&
    process.env.STARTOS_ALLOW_RELEASE_NOTES_PLACEHOLDER !== '1'
  ) {
    throw new Error('Replace the release-notes placeholder in startos/versions before merging or building.')
  }

  return current
}

/** @param {string[]} args */
function parseNotes(args) {
  const index = args.indexOf('--notes')
  if (index === -1) {
    return 'Maintenance release.'
  }
  const notes = args[index + 1]
  if (notes == null || notes === '') {
    throw new Error('--notes requires a value.')
  }
  return notes
}

/** @param {string} source */
function carriesMigration(source) {
  return !EMPTY_MIGRATIONS_RE.test(source)
}

/**
 * The version file as released at this version's tag. Tags from before the
 * current.ts layout hold a v0_6_0_1.ts-style file instead.
 * @param {string} version
 */
function readReleasedSource(version) {
  const tag = tagNameForVersion(version)
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync('git', args, { cwd: start9Dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`])
  } catch {
    throw new Error(
      `current.ts carries a migration, and tag ${tag} is not available to tell whether ${version} shipped it. Fetch tags (git fetch --tags) and retry.`,
    )
  }
  const parsed = parseVersion(version)
  const legacyFile = `v${parsed.major}_${parsed.minor}_${parsed.patch}_${parsed.revision}`
  for (const path of ['./startos/versions/current.ts', `./startos/versions/${legacyFile}.ts`]) {
    let source
    try {
      source = git(['show', `${tag}:${path}`])
    } catch {
      continue
    }
    if (readVersionFromSource(source, `${tag}:${path}`) === version) {
      return source
    }
  }
  throw new Error(`Tag ${tag} has no version file declaring ${version}.`)
}

/**
 * Give current.ts a new version and release notes, keeping its migration.
 * @param {string} source
 * @param {string} version
 * @param {string} releaseNotes
 */
function retargetSource(source, version, releaseNotes) {
  const notesMatch = /releaseNotes:\s*/.exec(source)
  if (!notesMatch) {
    throw new Error(`Could not find releaseNotes in ${currentPath}.`)
  }
  const start = notesMatch.index + notesMatch[0].length
  const quote = source[start]
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    throw new Error(`current.ts carries a migration and localized release notes. Set its version and notes by hand.`)
  }
  let end = start + 1
  while (end < source.length && source[end] !== quote) {
    end += source[end] === '\\' ? 2 : 1
  }
  if (end >= source.length || (quote === '`' && source.slice(start, end).includes('${'))) {
    throw new Error(`Could not read the release notes in ${currentPath}. Set its version and notes by hand.`)
  }
  return `${source.slice(0, start)}${JSON.stringify(releaseNotes)}${source.slice(end + 1)}`.replace(
    /version:\s*'[^']+'/,
    `version: '${version}'`,
  )
}

/**
 * Move a released version's migration to its own file and list it in the graph.
 * @param {string} version
 * @param {string} source
 */
function spinOffVersion(version, source) {
  const { file, exportName } = historicalNameForVersion(version)
  const path = join(versionsDir, `${file}.ts`)
  if (existsSync(path)) {
    throw new Error(`${path} already exists.`)
  }
  const historical = source.replace(/export const current\s*=/, `export const ${exportName} =`)
  if (historical === source) {
    throw new Error(`${currentPath} must export current.`)
  }

  const index = readIndexSource()
  const currentImport = "import { current } from './current'\n"
  const updated = index
    .replace(currentImport, `${currentImport}import { ${exportName} } from './${file}'\n`)
    .replace(/other:\s*\[[^\]]*\]/, `other: [${[exportName, ...readOtherExportNames()].join(', ')}]`)
  if (!updated.includes(`import { ${exportName} }`) || !updated.includes(`other: [${exportName}`)) {
    throw new Error(`Could not add ${exportName} to ${indexPath}.`)
  }

  writeFileSync(path, historical)
  writeFileSync(indexPath, updated)
  return `${file}.ts`
}

/**
 * Start9 bumps current.ts in place unless its version carries a migration. Here a
 * version is bumped only at release, so a migration in current.ts either shipped
 * with that version (keep it there in its own file) or was added since (it
 * belongs to the new version). The release tag tells which.
 * @param {string} targetVersion
 * @param {string} releaseNotes
 */
function setVersion(targetVersion, releaseNotes) {
  const oldVersion = currentVersion()

  if (targetVersion === oldVersion) {
    validateVersionGraph()
    console.log(targetVersion)
    return
  }

  if (compareVersions(targetVersion, oldVersion) <= 0) {
    throw new Error(`Target version ${targetVersion} must be greater than current version ${oldVersion}.`)
  }

  const source = readCurrentSource()
  let note = ''
  if (carriesMigration(source)) {
    const released = readReleasedSource(oldVersion)
    if (!carriesMigration(released)) {
      writeFileSync(currentPath, retargetSource(source, targetVersion, releaseNotes))
      validateVersionGraph()
      console.log(`${oldVersion} -> ${targetVersion} (carried the unreleased migration into ${targetVersion})`)
      return
    }
    if (released !== source) {
      const { file } = historicalNameForVersion(oldVersion)
      throw new Error(
        `${oldVersion} shipped with a migration, and current.ts has changed since. Move the released version to ${file}.ts by hand, then bump.`,
      )
    }
    note = ` (moved the ${oldVersion} migration to ${spinOffVersion(oldVersion, source)})`
  }

  writeFileSync(
    currentPath,
    `import { VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '${targetVersion}',
  releaseNotes: ${JSON.stringify(releaseNotes)},
  migrations: {},
})
`,
  )
  validateVersionGraph()

  console.log(`${oldVersion} -> ${targetVersion}${note}`)
}

const [command, value, ...rest] = process.argv.slice(2)

try {
  if (command == null || command === '' || command === '--help' || command === '-h') {
    usage()
    process.exit(command != null && command !== '' ? 0 : 1)
  }

  if (command === 'get') {
    console.log(currentVersion())
    process.exit(0)
  }

  if (command === 'tag') {
    console.log(tagNameForVersion(validateVersionGraph()))
    process.exit(0)
  }

  if (command === 'check') {
    const version = validateVersionGraph()
    console.log(`StartOS version graph OK: ${version} (${tagNameForVersion(version)})`)
    process.exit(0)
  }

  if (command === 'assert-tag') {
    if (value == null || value === '') {
      throw new Error('assert-tag requires a tag like v0.2.1_0.')
    }
    const expectedTag = tagNameForVersion(validateVersionGraph())
    if (value !== expectedTag) {
      throw new Error(`Tag ${value} does not match StartOS version ${currentVersion()}; expected ${expectedTag}.`)
    }
    console.log(`StartOS tag matches version graph: ${value}`)
    process.exit(0)
  }

  if (command === 'bump') {
    if (value == null || value === '') {
      throw new Error('bump requires major, minor, patch, or revision.')
    }
    setVersion(bumpVersion(currentVersion(), value), parseNotes(rest))
    process.exit(0)
  }

  if (command === 'set') {
    if (value == null || value === '') {
      throw new Error('set requires a version like 0.1.1:0.')
    }
    parseVersion(value)
    setVersion(value, parseNotes(rest))
    process.exit(0)
  }

  throw new Error(`Unknown command "${command}".`)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
