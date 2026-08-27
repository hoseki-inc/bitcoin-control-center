#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const start9Dir = dirname(scriptDir)
const versionsDir = join(start9Dir, 'startos', 'versions')
const indexPath = join(versionsDir, 'index.ts')

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+):(\d+)$/

function usage() {
  console.log(`Usage:
  node start9/scripts/version.mjs get
  node start9/scripts/version.mjs bump <major|minor|patch|revision> [--notes "Release notes"]
  node start9/scripts/version.mjs set <major.minor.patch:revision> [--notes "Release notes"]

Examples:
  node start9/scripts/version.mjs bump patch
  node start9/scripts/version.mjs bump revision --notes "Packaging-only rebuild."
  node start9/scripts/version.mjs set 0.2.0:0 --notes "Adds portfolio history repair."
`)
}

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

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}:${version.revision}`
}

function exportNameForVersion(version) {
  const parsed = parseVersion(version)
  return `v${parsed.major}_${parsed.minor}_${parsed.patch}_${parsed.revision}`
}

function readCurrentExportName() {
  const source = readFileSync(indexPath, 'utf8')
  const match = /current:\s*(v\d+_\d+_\d+_\d+)/.exec(source)
  if (!match) throw new Error(`Could not find current version in ${indexPath}.`)
  return match[1]
}

function readOtherExportNames() {
  const source = readFileSync(indexPath, 'utf8')
  const match = /other:\s*\[([^\]]*)\]/m.exec(source)
  if (!match) return []
  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^v\d+_\d+_\d+_\d+$/.test(part))
}

function readVersionForExport(exportName) {
  const versionPath = join(versionsDir, `${exportName}.ts`)
  const source = readFileSync(versionPath, 'utf8')
  const match = /version:\s*'([^']+)'/.exec(source)
  if (!match) throw new Error(`Could not find version string in ${versionPath}.`)
  return match[1]
}

function currentVersion() {
  return readVersionForExport(readCurrentExportName())
}

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

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (const key of ['major', 'minor', 'patch', 'revision']) {
    if (a[key] > b[key]) return 1
    if (a[key] < b[key]) return -1
  }
  return 0
}

function parseNotes(args) {
  const index = args.indexOf('--notes')
  if (index === -1) return 'Maintenance release.'
  const notes = args[index + 1]
  if (!notes) throw new Error('--notes requires a value.')
  return notes
}

function writeVersionFile(exportName, version, releaseNotes) {
  const versionPath = join(versionsDir, `${exportName}.ts`)
  if (existsSync(versionPath)) return

  writeFileSync(
    versionPath,
    `import { VersionInfo } from '@start9labs/start-sdk'

export const ${exportName} = VersionInfo.of({
  version: '${version}',
  releaseNotes: ${JSON.stringify(releaseNotes)},
  migrations: {},
})
`,
  )
}

function writeIndex(currentExportName, otherExportNames) {
  const allImports = [currentExportName, ...otherExportNames]
  const imports = allImports.map((name) => `import { ${name} } from './${name}'`).join('\n')
  const other = otherExportNames.length > 0 ? `[${otherExportNames.join(', ')}]` : '[]'

  writeFileSync(
    indexPath,
    `import { VersionGraph } from '@start9labs/start-sdk'
${imports}

export const versionGraph = VersionGraph.of({
  current: ${currentExportName},
  other: ${other},
})
`,
  )
}

function setVersion(targetVersion, releaseNotes) {
  const currentExportName = readCurrentExportName()
  const oldVersion = readVersionForExport(currentExportName)
  const targetExportName = exportNameForVersion(targetVersion)

  if (targetVersion === oldVersion) {
    console.log(targetVersion)
    return
  }

  if (compareVersions(targetVersion, oldVersion) <= 0) {
    throw new Error(`Target version ${targetVersion} must be greater than current version ${oldVersion}.`)
  }

  writeVersionFile(targetExportName, targetVersion, releaseNotes)

  const otherExportNames = [currentExportName, ...readOtherExportNames()].filter(
    (name, index, all) => name !== targetExportName && all.indexOf(name) === index,
  )
  writeIndex(targetExportName, otherExportNames)

  console.log(`${oldVersion} -> ${targetVersion}`)
}

const [command, value, ...rest] = process.argv.slice(2)

try {
  if (!command || command === '--help' || command === '-h') {
    usage()
    process.exit(command ? 0 : 1)
  }

  if (command === 'get') {
    console.log(currentVersion())
    process.exit(0)
  }

  if (command === 'bump') {
    if (!value) throw new Error('bump requires major, minor, patch, or revision.')
    setVersion(bumpVersion(currentVersion(), value), parseNotes(rest))
    process.exit(0)
  }

  if (command === 'set') {
    if (!value) throw new Error('set requires a version like 0.1.1:0.')
    parseVersion(value)
    setVersion(value, parseNotes(rest))
    process.exit(0)
  }

  throw new Error(`Unknown command "${command}".`)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
