#!/usr/bin/env node
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

/**
 * Start9 bumps current.ts in place unless its version carries a migration, which
 * must first move to its own historical file so it still runs.
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

  if (!/migrations:\s*\{\s*\}/.test(readCurrentSource())) {
    const { file, exportName } = historicalNameForVersion(oldVersion)
    throw new Error(
      `${oldVersion} carries a migration. Move current.ts to ${file}.ts exporting ${exportName}, add it to other, then bump.`,
    )
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

  console.log(`${oldVersion} -> ${targetVersion}`)
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
