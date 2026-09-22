#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const start9Dir = dirname(scriptDir)
const versionsDir = join(start9Dir, 'startos', 'versions')
const indexPath = join(versionsDir, 'index.ts')

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

/** @param {unknown} version */
function parseVersion(version) {
  if (typeof version !== 'string') {
    throw new Error('StartOS version must be a string.')
  }

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

function tagNameForVersion(version) {
  const parsed = parseVersion(version)
  return `v${parsed.major}.${parsed.minor}.${parsed.patch}_${parsed.revision}`
}

function readIndexSource() {
  return readFileSync(indexPath, 'utf8')
}

function readCurrentExportName() {
  const source = readIndexSource()
  const match = /current:\s*(v\d+_\d+_\d+_\d+)/.exec(source)
  if (!match) {
    throw new Error(`Could not find current version in ${indexPath}.`)
  }
  return match[1]
}

function readOtherExportNames() {
  const source = readIndexSource()
  const match = /other:\s*\[([^\]]*)\]/m.exec(source)
  if (!match) {
    return []
  }
  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^v\d+_\d+_\d+_\d+$/.test(part))
}

function readVersionForExport(exportName) {
  const versionPath = join(versionsDir, `${exportName}.ts`)
  if (!existsSync(versionPath)) {
    throw new Error(`Version graph references missing file ${versionPath}.`)
  }

  const source = readFileSync(versionPath, 'utf8')
  const exportPattern = new RegExp(`export const ${exportName}\\s*=`)
  if (!exportPattern.test(source)) {
    throw new Error(`${versionPath} must export ${exportName}.`)
  }

  const match = /version:\s*'([^']+)'/.exec(source)
  if (!match) {
    throw new Error(`Could not find version string in ${versionPath}.`)
  }
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
  const currentExportName = readCurrentExportName()
  const otherExportNames = readOtherExportNames()
  const referencedExportNames = [currentExportName, ...otherExportNames]

  if (new Set(referencedExportNames).size !== referencedExportNames.length) {
    throw new Error('StartOS version graph contains duplicate version exports.')
  }

  const importedExportNames = [
    ...source.matchAll(/import \{ (v\d+_\d+_\d+_\d+) \} from '\.\/(v\d+_\d+_\d+_\d+)'/g),
  ].map(([, exportName, pathName]) => {
    if (exportName !== pathName) {
      throw new Error(`Version import ${exportName} must come from ./${exportName}.`)
    }
    return exportName
  })

  if (new Set(importedExportNames).size !== importedExportNames.length) {
    throw new Error('StartOS version graph contains duplicate imports.')
  }

  const referenced = new Set(referencedExportNames)
  const imported = new Set(importedExportNames)
  const missingImports = referencedExportNames.filter((name) => !imported.has(name))
  const unusedImports = importedExportNames.filter((name) => !referenced.has(name))
  if (missingImports.length > 0 || unusedImports.length > 0) {
    throw new Error(
      `StartOS version imports do not match the graph (missing: ${missingImports.join(', ') || 'none'}; unused: ${unusedImports.join(', ') || 'none'}).`,
    )
  }

  const versionFiles = readdirSync(versionsDir)
    .filter((name) => /^v\d+_\d+_\d+_\d+\.ts$/.test(name))
    .map((name) => name.slice(0, -3))
  const unreferencedFiles = versionFiles.filter((name) => !referenced.has(name))
  if (unreferencedFiles.length > 0) {
    throw new Error(`StartOS version files are not referenced by the graph: ${unreferencedFiles.join(', ')}.`)
  }

  const versionsWithPlaceholderNotes = referencedExportNames.filter((exportName) =>
    readFileSync(join(versionsDir, `${exportName}.ts`), 'utf8').includes(RELEASE_NOTES_PLACEHOLDER_MARKER),
  )
  if (versionsWithPlaceholderNotes.length > 0 && process.env.STARTOS_ALLOW_RELEASE_NOTES_PLACEHOLDER !== '1') {
    throw new Error(
      `Replace the release-notes placeholder in ${versionsWithPlaceholderNotes.join(', ')}.ts before merging or building.`,
    )
  }

  const versions = referencedExportNames.map((exportName) => {
    const version = readVersionForExport(exportName)
    parseVersion(version)
    if (exportNameForVersion(version) !== exportName) {
      throw new Error(
        `${exportName}.ts declares ${version}; expected export/file name ${exportNameForVersion(version)}.`,
      )
    }
    return version
  })

  if (new Set(versions).size !== versions.length) {
    throw new Error('StartOS version graph contains duplicate version strings.')
  }

  for (let index = 1; index < versions.length; index += 1) {
    if (compareVersions(versions[index - 1], versions[index]) <= 0) {
      throw new Error(
        `StartOS versions must be newest-first; ${versions[index - 1]} is not greater than ${versions[index]}.`,
      )
    }
  }

  return versions[0]
}

function parseNotes(args) {
  const index = args.indexOf('--notes')
  if (index === -1) {
    return 'Maintenance release.'
  }
  const notes = args[index + 1]
  if (!notes) {
    throw new Error('--notes requires a value.')
  }
  return notes
}

function writeVersionFile(exportName, version, releaseNotes) {
  const versionPath = join(versionsDir, `${exportName}.ts`)
  if (existsSync(versionPath)) {
    return
  }

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
    validateVersionGraph()
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
  validateVersionGraph()

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
    if (!value) {
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
    if (!value) {
      throw new Error('bump requires major, minor, patch, or revision.')
    }
    setVersion(bumpVersion(currentVersion(), value), parseNotes(rest))
    process.exit(0)
  }

  if (command === 'set') {
    if (!value) {
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
