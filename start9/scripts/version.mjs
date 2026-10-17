#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const start9Dir = dirname(scriptDir)
const versionsDir = join(start9Dir, 'startos', 'versions')
const indexPath = join(versionsDir, 'index.ts')
const currentPath = join(versionsDir, 'current.ts')

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+):(\d+)$/
const RELEASE_NOTES_PLACEHOLDER_MARKER = 'STARTOS_RELEASE_NOTES_REQUIRED'
const require = createRequire(import.meta.url)
const MIGRATION_GUIDANCE = `  // Before adding a migration, run: node start9/scripts/version.mjs bump revision
  // Keep released migration code and its helpers unchanged.
`

function usage() {
  console.log(`Usage:
  node start9/scripts/version.mjs get
  node start9/scripts/version.mjs tag
  node start9/scripts/version.mjs check [--identity-only]
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

/** @param {string} source */
function normalizeLineEndings(source) {
  return source.replace(/\r\n/g, '\n')
}

function readIndexSource() {
  return normalizeLineEndings(readFileSync(indexPath, 'utf8'))
}

function readCurrentSource() {
  if (!existsSync(currentPath)) {
    throw new Error(`StartOS current version file ${currentPath} is missing.`)
  }
  return normalizeLineEndings(readFileSync(currentPath, 'utf8'))
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

/**
 * Check the graph's identity and files using Node built-ins only, so release
 * identity reads stay free of installed dependencies.
 */
function readVersionGraph() {
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
  const otherExportNames = readOtherExportNames()
  if (new Set(otherExportNames).size !== otherExportNames.length) {
    throw new Error('StartOS version graph contains duplicate migration checkpoints.')
  }
  const others = otherExportNames.map((exportName) => {
    const importMatch = new RegExp(`import \\{ ${exportName} \\} from '\\./(v[^']+)'`).exec(source)
    if (!importMatch) {
      throw new Error(`Version graph references ${exportName} without importing it.`)
    }
    const path = join(versionsDir, `${importMatch[1]}.ts`)
    if (!existsSync(path)) {
      throw new Error(`Version graph references missing file ${path}.`)
    }
    const fileSource = normalizeLineEndings(readFileSync(path, 'utf8'))
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
    return { file: importMatch[1], source: fileSource, path }
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

  return { current, others }
}

/** The current version, after a dependency-free check of the graph. */
function validateVersionGraph() {
  return readVersionGraph().current
}

/** The current version, after also parsing every version file's migrations with TypeScript. */
function validateVersionFiles() {
  const { current, others } = readVersionGraph()
  readMigrationInfo(readCurrentSource(), currentPath)
  for (const historical of others) {
    readMigrationInfo(historical.source, historical.path)
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
 * @typedef {{ hasMigration: boolean, nameStart: number, nameEnd: number,
 * versionStart: number, versionEnd: number, notesStart: number, notesEnd: number,
 * guidanceStart: number | null, guidanceEnd: number | null }} MigrationInfo
 */

/** @type {Map<string, MigrationInfo>} */
const migrationInfoCache = new Map()

/**
 * Inspect syntax without executing migration code. Kept lazy so release identity
 * reads still need only Node built-ins; development/CI checks and bumps install
 * the existing StartOS devDependencies, including TypeScript.
 * @param {string} source
 * @param {string} path
 * @returns {MigrationInfo}
 */
function readMigrationInfo(source, path) {
  const cacheKey = path + '\0' + source
  const cached = migrationInfoCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }
  /** @type {typeof import('typescript')} */
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- SAFETY: This fixed module is the project's pinned TypeScript compiler; createRequire keeps it out of dependency-free identity reads.
  const ts = require('typescript')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  // Ask the public compiler API for syntax diagnostics without emitting code or
  // resolving imports. The version file is the only source this host supplies.
  /** @type {import('typescript').CompilerHost} */
  const host = {
    getSourceFile: () => file,
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: () => true,
    readFile: () => source,
  }
  const diagnostics = ts.createProgram([path], { noResolve: true, noLib: true }, host).getSyntacticDiagnostics(file)
  if (diagnostics.length > 0) {
    throw new Error(
      `${path} is not valid TypeScript: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n')}`,
    )
  }
  /** @type {{ declaration: import('typescript').VariableDeclaration, options: import('typescript').Expression | undefined }[]} */
  const versions = []
  for (const statement of file.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true
    ) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      let call = declaration.initializer
      while (call !== undefined && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)) {
        if (call.expression.expression.getText(file) === 'VersionInfo' && call.expression.name.text === 'of') {
          versions.push({ declaration, options: call.arguments[0] })
          break
        }
        call = call.expression.expression
      }
    }
  }
  const candidate = versions[0]
  if (versions.length !== 1 || candidate?.options === undefined || !ts.isObjectLiteralExpression(candidate.options)) {
    throw new Error(`${path} must export one VersionInfo.of object literal.`)
  }
  const { declaration, options } = candidate
  if (options.properties.some((p) => ts.isSpreadAssignment(p) || ts.isComputedPropertyName(p.name))) {
    throw new Error(`${path} must declare VersionInfo.of properties explicitly, without spreads or computed names.`)
  }
  const properties = options.properties.filter(
    (property) => property.name?.getText(file).replace(/^['"]|['"]$/g, '') === 'migrations',
  )
  if (
    properties.length !== 1 ||
    !ts.isPropertyAssignment(properties[0]) ||
    !ts.isObjectLiteralExpression(properties[0].initializer)
  ) {
    throw new Error(`${path} must declare migrations once, as an object literal in VersionInfo.of.`)
  }
  /** @param {string} name */
  const property = (name) =>
    options.properties
      .filter(ts.isPropertyAssignment)
      .find((p) => p.name.getText(file).replace(/^['"]|['"]$/g, '') === name)
  const version = property('version')?.initializer
  const notes = property('releaseNotes')?.initializer
  if (version === undefined || !ts.isStringLiteral(version) || notes === undefined) {
    throw new Error(`${path} must declare a literal version and releaseNotes in VersionInfo.of.`)
  }
  const leadingStart = properties[0].getFullStart()
  const guidanceOffset = source.slice(leadingStart, properties[0].getStart(file)).indexOf(MIGRATION_GUIDANCE)
  const guidanceStart = guidanceOffset === -1 ? null : leadingStart + guidanceOffset
  const info = {
    hasMigration: properties[0].initializer.properties.length > 0,
    guidanceStart,
    guidanceEnd: guidanceStart === null ? null : guidanceStart + MIGRATION_GUIDANCE.length,
    nameStart: declaration.name.getStart(file),
    nameEnd: declaration.name.end,
    versionStart: version.getStart(file),
    versionEnd: version.end,
    notesStart: notes.getStart(file),
    notesEnd: notes.end,
  }
  migrationInfoCache.set(cacheKey, info)
  return info
}

/**
 * Read the released version at its immutable tag. Always verify a missing local
 * tag: an empty local migration may be a removed shipped migration.
 * Repositories with no remotes use their own complete local tag history.
 * @param {string} version
 */
function readReleasedSource(version) {
  const tag = tagNameForVersion(version)
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync('git', args, {
      cwd: start9Dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
  try {
    git(['rev-parse', '--git-dir'])
  } catch {
    throw new Error('Bumping a StartOS version requires a Git repository so its release history can be checked.')
  }
  let tagged = false
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`])
    tagged = true
  } catch {
    // A migration checkpoint may intentionally have no release tag.
  }
  if (!tagged) {
    const remotes = git(['remote']).trim().split(/\s+/).filter(Boolean)
    if (remotes.includes('origin')) {
      const remoteTag = spawnSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], {
        cwd: start9Dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      if (remoteTag.status === 2) {
        return null
      }
      if (remoteTag.status !== 0) {
        throw new Error(`Could not verify whether ${tag} was released. Fetch release tags from origin before bumping.`)
      }
      throw new Error(
        `Release tag ${tag} exists on origin but is missing locally. Run git fetch origin tag ${tag}, then retry.`,
      )
    }
    if (remotes.length > 0 || git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
      throw new Error(
        `Cannot establish the release history for ${tag}. Use a complete checkout with origin before bumping a version.`,
      )
    }
    return null
  }
  const parsed = parseVersion(version)
  const legacyFile = `v${parsed.major}_${parsed.minor}_${parsed.patch}_${parsed.revision}`
  for (const path of ['./startos/versions/current.ts', `./startos/versions/${legacyFile}.ts`]) {
    let source
    try {
      source = normalizeLineEndings(git(['show', `${tag}:${path}`]))
    } catch {
      continue
    }
    if (readVersionFromSource(source, `${tag}:${path}`) === version) {
      return { source, path: `${tag}:${path}`, tag }
    }
  }
  throw new Error(`Tag ${tag} has no version file declaring ${version}.`)
}

/**
 * Give an accidentally unversioned, unshipped migration its new identity.
 * @param {string} source
 * @param {MigrationInfo} info
 * @param {string} version
 * @param {string} releaseNotes
 */
function retargetSource(source, info, version, releaseNotes) {
  const edits = [
    { start: info.versionStart, end: info.versionEnd, text: `'${version}'` },
    { start: info.notesStart, end: info.notesEnd, text: JSON.stringify(releaseNotes) },
  ].sort((left, right) => right.start - left.start)
  for (const edit of edits) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
  }
  return source
}

/**
 * A current.ts for a version with no migration of its own.
 * @param {string} version
 * @param {string} releaseNotes
 */
function freshSource(version, releaseNotes) {
  return `import { VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '${version}',
  releaseNotes: ${JSON.stringify(releaseNotes)},
${MIGRATION_GUIDANCE}  migrations: {},
})
`
}

/**
 * Preserve a migration checkpoint under its original version.
 * @param {string} version
 * @param {string} source
 * @param {MigrationInfo} info
 */
function prepareSpinOff(version, source, info) {
  const { file, exportName } = historicalNameForVersion(version)
  const path = join(versionsDir, `${file}.ts`)
  if (existsSync(path)) {
    throw new Error(`${path} already exists.`)
  }
  if (info.guidanceStart !== null && info.guidanceEnd !== null) {
    source = source.slice(0, info.guidanceStart) + source.slice(info.guidanceEnd)
  }
  const historical = `${source.slice(0, info.nameStart)}${exportName}${source.slice(info.nameEnd)}`
  readMigrationInfo(historical, path)
  const index = readIndexSource()
  const currentImport = "import { current } from './current'\n"
  const updated = index
    .replace(currentImport, `${currentImport}import { ${exportName} } from './${file}'\n`)
    .replace(/other:\s*\[[^\]]*\]/, `other: [${[exportName, ...readOtherExportNames()].join(', ')}]`)
  if (!updated.includes(`import { ${exportName} }`) || !updated.includes(`other: [${exportName}`)) {
    throw new Error(`Could not add ${exportName} to ${indexPath}.`)
  }
  return {
    file: `${file}.ts`,
    write: () => {
      writeFileSync(path, historical)
      writeFileSync(indexPath, updated)
    },
  }
}

/**
 * Bump before writing a migration. Its version remains its identity even when
 * the revision was only used by test builds and never published. Released code
 * must remain unchanged apart from Git's line-ending conversion; edits need a
 * new migration checkpoint.
 * @param {string} targetVersion
 * @param {string} releaseNotes
 */
function setVersion(targetVersion, releaseNotes) {
  const oldVersion = validateVersionFiles()
  if (targetVersion === oldVersion) {
    console.log(targetVersion)
    return
  }
  if (compareVersions(targetVersion, oldVersion) <= 0) {
    throw new Error(`Target version ${targetVersion} must be greater than current version ${oldVersion}.`)
  }
  const source = readCurrentSource()
  const info = readMigrationInfo(source, currentPath)
  const released = readReleasedSource(oldVersion)
  const releasedInfo = released == null ? null : readMigrationInfo(released.source, released.path)
  if (releasedInfo?.hasMigration === true && source !== released.source) {
    throw new Error(
      `The shipped ${oldVersion} migration file was changed. Restore current.ts from ${released.tag}, run node start9/scripts/version.mjs bump revision, then reapply the new migration in current.ts. Keep released migration code and its helpers unchanged.`,
    )
  }
  // Compatibility for a migration added to the last release without bumping:
  // the tag proves no migration shipped under that identity, so carry it once.
  const carry = info.hasMigration && released != null && releasedInfo?.hasMigration === false
  const next = carry
    ? retargetSource(source, info, targetVersion, releaseNotes)
    : freshSource(targetVersion, releaseNotes)
  readMigrationInfo(next, currentPath)
  const spinOff = info.hasMigration && !carry ? prepareSpinOff(oldVersion, source, info) : null
  spinOff?.write()
  writeFileSync(currentPath, next)
  validateVersionFiles()
  const detail = spinOff
    ? ` (preserved the ${oldVersion} migration in ${spinOff.file})`
    : carry
      ? ` (carried the unshipped migration into ${targetVersion}; bump revision before adding the next migration)`
      : ''
  console.log(`${oldVersion} -> ${targetVersion}${detail}`)
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
    if (value != null && value !== '--identity-only') {
      throw new Error('check accepts only --identity-only (for the dependency-free release identity job).')
    }
    const version = value === '--identity-only' ? validateVersionGraph() : validateVersionFiles()
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
