import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

const script = fileURLToPath(new URL('../scripts/version.mjs', import.meta.url))
const dependencies = fileURLToPath(new URL('../node_modules', import.meta.url))
const tsxLoader = fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url))
const index = `import { VersionGraph } from '@start9labs/start-sdk'
import { current } from './current'

export const versionGraph = VersionGraph.of({
  current,
  other: [],
})
`
const migration = `{
    up: async ({ effects }) => {
      await seed(effects)
    },
  }`

function versionFile(exportName: string, version: string, migrations = '{}'): string {
  return `import { VersionInfo } from '@start9labs/start-sdk'

export const ${exportName} = VersionInfo.of({
  version: '${version}',
  releaseNotes: \`Notes for ${version}.

- A change.\`,
  migrations: ${migrations},
})
`
}

type Repository = {
  root: string
  git: (...args: string[]) => string
  write: (file: string, contents: string) => void
  read: (file: string) => string
  remove: (file: string) => void
  exists: (file: string) => boolean
  snapshot: () => string
  release: (tag: string) => void
  bump: (...args: string[]) => { status: number | null; output: string }
  migrate: (from: string) => string
}

/** A throwaway repository holding the real version script and SDK. */
function setupRepository(installDependencies = true): Repository {
  const root = mkdtempSync(join(tmpdir(), 'startos-version-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const start9 = join(root, 'start9')
  const versions = join(start9, 'startos', 'versions')
  mkdirSync(versions, { recursive: true })
  mkdirSync(join(start9, 'scripts'))
  copyFileSync(script, join(start9, 'scripts', 'version.mjs'))
  if (installDependencies) {
    symlinkSync(dependencies, join(start9, 'node_modules'), 'junction')
  }
  // Ignore the developer's git configuration, such as commit signing.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  git('init', '-q')
  return {
    root,
    git,
    write: (file, contents) => {
      writeFileSync(join(versions, file), contents)
    },
    read: (file) => readFileSync(join(versions, file), 'utf8'),
    remove: (file) => {
      rmSync(join(versions, file))
    },
    exists: (file) => existsSync(join(versions, file)),
    snapshot: () =>
      JSON.stringify(
        readdirSync(versions)
          .sort()
          .map((file) => [file, readFileSync(join(versions, file), 'utf8')]),
      ),
    release: (tag) => {
      git('add', 'start9/scripts', 'start9/startos')
      git('commit', '-q', '-m', tag)
      git('tag', tag)
    },
    bump: (...args) => {
      const result = spawnSync(process.execPath, [join(start9, 'scripts', 'version.mjs'), ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
      })
      return { status: result.status, output: `${result.stdout}${result.stderr}` }
    },
    migrate: (from) => {
      const result = spawnSync(process.execPath, ['--import', tsxLoader, '--input-type=module', '-'], {
        cwd: root,
        env,
        encoding: 'utf8',
        input: `const steps = [];
globalThis.seed = async () => { steps.push('seed') };
globalThis.reseed = async () => { steps.push('reseed') };
const { versionGraph } = await import(${JSON.stringify(pathToFileURL(join(versions, 'index.ts')).href)});
let version = ${JSON.stringify(from)};
await versionGraph.init({ getDataVersion: async () => version, setDataVersion: async ({ version: next }) => { version = next } }, 'update');
console.log(JSON.stringify({ version, steps }));`,
      })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout.trim().split('\n').at(-1) ?? ''
    },
  }
}

describe('migration checkpoints', () => {
  it('preserves unpublished revisions and runs each migration once for release and test-build users', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    repo.release('v0.6.1_0')
    expect(repo.bump('bump', 'revision').status).toBe(0)
    repo.write('current.ts', versionFile('current', '0.6.1:1', migration))
    expect(repo.bump('bump', 'revision').status).toBe(0)
    repo.write('current.ts', versionFile('current', '0.6.1:2', migration.replace('seed(effects)', 'reseed(effects)')))

    expect(repo.bump('bump', 'patch', '--notes', 'Public release.').status).toBe(0)
    expect(repo.exists('v0.6.1_1.ts')).toBe(true)
    expect(repo.exists('v0.6.1_2.ts')).toBe(true)
    expect(repo.read('current.ts')).toContain('migrations: {}')
    expect(repo.migrate('0.6.1:0')).toBe('{"version":"0.6.2:0","steps":["seed","reseed"]}')
    expect(repo.migrate('0.6.1:1')).toBe('{"version":"0.6.2:0","steps":["reseed"]}')
    expect(repo.migrate('0.6.1:2')).toBe('{"version":"0.6.2:0","steps":[]}')
  }, 15000)

  it('spins off an unchanged shipped migration and removes current-only guidance', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    expect(repo.bump('bump', 'revision').status).toBe(0)
    repo.write('current.ts', repo.read('current.ts').replace('migrations: {}', `migrations: ${migration}`))
    repo.release('v0.6.1_1')

    const result = repo.bump('bump', 'patch', '--notes', 'Next release.')

    expect(result.status).toBe(0)
    expect(repo.read('v0.6.1_1.ts')).toContain('export const v_0_6_1_1')
    expect(repo.read('v0.6.1_1.ts')).not.toContain('Before adding a migration')
    expect(repo.migrate('0.6.1:1')).toBe('{"version":"0.6.2:0","steps":[]}')
    expect(repo.migrate('0.6.1:0')).toBe('{"version":"0.6.2:0","steps":["seed"]}')
  }, 15000)

  it('carries a migration added without bumping when the tag proves it never shipped', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    repo.release('v0.6.1_0')
    repo.write('current.ts', versionFile('current', '0.6.1:0', migration))

    expect(repo.bump('bump', 'patch', '--notes', 'New migration.').status).toBe(0)
    expect(repo.exists('v0.6.1_0.ts')).toBe(false)
    expect(repo.read('current.ts')).toContain('await seed(effects)')
    expect(repo.migrate('0.6.1:0')).toBe('{"version":"0.6.2:0","steps":["seed"]}')
  })

  it('reads migration-free releases tagged before the current.ts layout', () => {
    const repo = setupRepository()
    repo.write('index.ts', index.replaceAll('current', 'v0_6_0_1'))
    repo.write('v0_6_0_1.ts', versionFile('v0_6_0_1', '0.6.0:1'))
    repo.release('v0.6.0_1')
    repo.remove('v0_6_0_1.ts')
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.0:1', migration))

    expect(repo.bump('bump', 'revision').status).toBe(0)
    expect(repo.read('current.ts')).toContain("version: '0.6.0:2'")
    expect(repo.migrate('0.6.0:1')).toBe('{"version":"0.6.0:2","steps":["seed"]}')
  })

  it.each([
    ['formatting', migration, '{ up: async ({ effects, }) => { await seed(effects); }, }'],
    [
      'template interpolation formatting',
      '{ up: async () => { const value = 1; void `${value+1}` } }',
      '{ up: async () => { const value = 1; void `${value + 1}` } }',
    ],
    ['string content', "{ up: async () => { void 'Savings,]' } }", "{ up: async () => { void 'Savings]' } }"],
    [
      'an extended migration',
      migration,
      migration.replace('await seed(effects)', 'await seed(effects); await reseed(effects)'),
    ],
    ['a cleared migration', migration, '{}'],
  ])('refuses changed shipped code (%s), without writing files', (_name, before, after) => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0', before))
    repo.release('v0.6.1_0')
    repo.write('current.ts', versionFile('current', '0.6.1:0', after))
    const snapshot = repo.snapshot()

    const result = repo.bump('bump', 'patch')

    expect(result.status).toBe(1)
    expect(result.output).toContain('migration file was changed')
    expect(result.output).toContain('bump revision')
    expect(repo.snapshot()).toBe(snapshot)
  })

  it('refuses a changed local helper used by a shipped migration', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    const source =
      versionFile('current', '0.6.1:0', '{ up: migrate }') + '\nasync function migrate() { await seed() }\n'
    repo.write('current.ts', source)
    repo.release('v0.6.1_0')
    repo.write('current.ts', source.replace('await seed()', 'await reseed()'))
    const snapshot = repo.snapshot()

    expect(repo.bump('bump', 'patch').output).toContain('migration file was changed')
    expect(repo.snapshot()).toBe(snapshot)
  })

  it('accepts regexes and preserves unpublished code without normalizing its literals', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    const code =
      '{ up: async ({ effects }) => { const quotes = /[\'"]/g; const braces = /\\{\\{/g; void `${quotes}${braces}Savings,]`; await seed(effects) } }'
    const source = versionFile('current', '0.6.1:1', code)
    repo.write('current.ts', source)

    expect(repo.bump('check').status).toBe(0)
    expect(repo.bump('bump', 'patch').status).toBe(0)
    expect(repo.read('v0.6.1_1.ts')).toBe(source.replace('export const current', 'export const v_0_6_1_1'))
    expect(repo.migrate('0.6.1:0')).toBe('{"version":"0.6.2:0","steps":["seed"]}')
  })

  it('retargets an unshipped migration when releaseNotes precede version', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    repo.release('v0.6.1_0')
    repo.write(
      'current.ts',
      `import { VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({ releaseNotes: 'Before.', version: '0.6.1:0', migrations: ${migration} })`,
    )

    expect(repo.bump('bump', 'patch', '--notes', 'After.').status).toBe(0)
    expect(repo.read('current.ts')).toContain('releaseNotes: "After."')
    expect(repo.read('current.ts')).toContain("version: '0.6.2:0'")
    expect(repo.migrate('0.6.1:0')).toBe('{"version":"0.6.2:0","steps":["seed"]}')
  })

  it('removes guidance only from comments, preserving matching release-note text', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    expect(repo.bump('bump', 'revision').status).toBe(0)
    const guidance =
      '  // Before adding a migration, run: node start9/scripts/version.mjs bump revision\n  // Keep released migration code and its helpers unchanged.\n'
    repo.write(
      'current.ts',
      repo
        .read('current.ts')
        .replace('"Maintenance release."', '`\n' + guidance + '`')
        .replace('migrations: {}', `migrations: ${migration}`),
    )

    expect(repo.bump('bump', 'patch').status).toBe(0)
    expect(repo.read('v0.6.1_1.ts').match(/Before adding a migration/g)).toHaveLength(1)
  })

  it('rejects malformed TypeScript before writing any version files', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0', '{ up: }'))
    const snapshot = repo.snapshot()

    expect(repo.bump('check').output).toContain('not valid TypeScript')
    expect(repo.bump('bump', 'revision').status).toBe(1)
    expect(repo.snapshot()).toBe(snapshot)
  })

  it('rejects unsupported shorthand in check as well as bump', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write(
      'current.ts',
      versionFile('current', '0.6.1:0').replace('migrations: {}', 'migrations') + '\nconst migrations = {}\n',
    )
    const snapshot = repo.snapshot()

    expect(repo.bump('check').output).toContain('as an object literal')
    expect(repo.bump('bump', 'patch').status).toBe(1)
    expect(repo.snapshot()).toBe(snapshot)
  })

  it.each(['...overrides', "['migrations']: { up: seed }"])(
    'rejects options that can override the declared migration: %s',
    (override) => {
      const repo = setupRepository()
      repo.write('index.ts', index)
      repo.write(
        'current.ts',
        versionFile('current', '0.6.1:0').replace('migrations: {},', `migrations: {}, ${override},`),
      )
      const snapshot = repo.snapshot()

      expect(repo.bump('check').output).toContain('without spreads or computed names')
      expect(repo.bump('bump', 'patch').status).toBe(1)
      expect(repo.snapshot()).toBe(snapshot)
    },
  )

  it('does not mistake release-note text for the migrations field', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write(
      'current.ts',
      versionFile('current', '0.6.1:1', migration).replace('Notes for 0.6.1:1.', 'Notes mentioning migrations: {}.'),
    )

    expect(repo.bump('bump', 'patch').status).toBe(0)
    expect(repo.read('v0.6.1_1.ts')).toContain('await seed(effects)')
    expect(repo.read('current.ts')).toContain('migrations: {}')
  })
})

describe('release history and identity', () => {
  it.each(['unchanged', 'edited'] as const)(
    'checks a shipped migration in a Git CRLF checkout (%s)',
    (state) => {
      const repo = setupRepository()
      repo.git('config', 'core.autocrlf', 'false')
      repo.write('index.ts', index)
      repo.write('current.ts', versionFile('current', '0.6.1:1', migration))
      repo.release('v0.6.1_1')
      repo.git('config', 'core.autocrlf', 'true')
      repo.remove('current.ts')
      repo.remove('index.ts')
      repo.git('checkout', '--', 'start9/startos/versions/current.ts', 'start9/startos/versions/index.ts')
      expect(repo.read('current.ts')).toContain('\r\n')
      expect(repo.read('index.ts')).toContain('\r\n')
      expect(repo.git('status', '--porcelain', '--', 'start9/startos')).toBe('')

      if (state === 'edited') {
        repo.write('current.ts', repo.read('current.ts').replace('await seed(effects)', 'await reseed(effects)'))
      }
      const snapshot = repo.snapshot()
      const result = repo.bump('bump', 'patch')

      if (state === 'edited') {
        expect(result.status).toBe(1)
        expect(result.output).toContain('migration file was changed')
        expect(repo.snapshot()).toBe(snapshot)
        return
      }
      expect(result.status, result.output).toBe(0)
      expect(repo.read('index.ts')).toContain("import { v_0_6_1_1 } from './v0.6.1_1'")
      expect(repo.read('v0.6.1_1.ts')).toBe(versionFile('v_0_6_1_1', '0.6.1:1', migration))
      expect(repo.migrate('0.6.1:0')).toBe('{"version":"0.6.2:0","steps":["seed"]}')
      expect(repo.migrate('0.6.1:1')).toBe('{"version":"0.6.2:0","steps":[]}')
    },
    15000,
  )

  it('rejects duplicate migration checkpoints before checking or changing the graph', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:1', migration))
    expect(repo.bump('bump', 'patch').status).toBe(0)
    repo.write('index.ts', repo.read('index.ts').replace('other: [v_0_6_1_1]', 'other: [v_0_6_1_1, v_0_6_1_1]'))
    const snapshot = repo.snapshot()

    for (const args of [['check'], ['check', '--identity-only'], ['bump', 'revision']]) {
      const result = repo.bump(...args)
      expect(result.status).toBe(1)
      expect(result.output).toContain('duplicate migration checkpoints')
      expect(repo.snapshot()).toBe(snapshot)
    }
  })

  it('requires fetching a shipped migration even when the local migration was cleared', () => {
    const origin = setupRepository()
    origin.write('index.ts', index)
    origin.write('current.ts', versionFile('current', '0.6.1:1', migration))
    origin.release('v0.6.1_1')
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:1'))
    repo.git('remote', 'add', 'origin', origin.root)
    const snapshot = repo.snapshot()

    const missingTag = repo.bump('bump', 'patch')
    expect(missingTag.status).toBe(1)
    expect(missingTag.output).toContain('exists on origin but is missing locally')
    expect(repo.snapshot()).toBe(snapshot)

    repo.git('fetch', '-q', 'origin', 'tag', 'v0.6.1_1')
    const cleared = repo.bump('bump', 'patch')
    expect(cleared.status).toBe(1)
    expect(cleared.output).toContain('migration file was changed')
    expect(repo.snapshot()).toBe(snapshot)

    repo.write('current.ts', origin.read('current.ts'))
    expect(repo.bump('bump', 'patch').status).toBe(0)
    expect(repo.migrate('0.6.1:0')).toBe('{"version":"0.6.2:0","steps":["seed"]}')
  }, 15000)

  it('requires fetching a tag that exists on origin but is missing locally', () => {
    const origin = setupRepository()
    origin.write('index.ts', index)
    origin.write('current.ts', versionFile('current', '0.6.1:0', migration))
    origin.release('v0.6.1_0')
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0', migration))
    repo.git('remote', 'add', 'origin', origin.root)
    const snapshot = repo.snapshot()

    expect(repo.bump('bump', 'patch').output).toContain('exists on origin but is missing locally')
    expect(repo.snapshot()).toBe(snapshot)
  })

  it.each([
    ['a migration', migration],
    ['empty migrations', '{}'],
  ])('bumps an unpublished version with %s after origin confirms its tag does not exist', (_name, migrations) => {
    const origin = setupRepository()
    origin.write('index.ts', index)
    origin.write('current.ts', versionFile('current', '0.6.1:0'))
    origin.release('v0.6.1_0')
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:1', migrations))
    repo.git('remote', 'add', 'origin', origin.root)

    expect(repo.bump('bump', 'patch').status).toBe(0)
    expect(repo.exists('v0.6.1_1.ts')).toBe(migrations !== '{}')
  })

  it.each([
    ['a migration', migration],
    ['empty migrations', '{}'],
  ])('stops before writing with %s when origin cannot be checked', (_name, migrations) => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:1', migrations))
    repo.git('remote', 'add', 'origin', join(repo.root, 'missing-origin'))
    const snapshot = repo.snapshot()

    expect(repo.bump('bump', 'patch').output).toContain('Could not verify whether')
    expect(repo.snapshot()).toBe(snapshot)
  })

  it.each([
    ['a migration', migration],
    ['empty migrations', '{}'],
  ])('refuses incomplete local-only history with %s', (_name, migrations) => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    repo.release('v0.6.1_0')
    writeFileSync(join(repo.root, '.git', 'shallow'), repo.git('rev-parse', 'HEAD'))
    repo.write('current.ts', versionFile('current', '0.6.1:1', migrations))
    const snapshot = repo.snapshot()

    expect(repo.bump('bump', 'patch').output).toContain('Cannot establish the release history')
    expect(repo.snapshot()).toBe(snapshot)
  })

  it('keeps protected release identity reads free of compiler dependencies', () => {
    const repo = setupRepository(false)
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    const compiler = join(repo.root, 'start9', 'node_modules', 'typescript')
    mkdirSync(compiler, { recursive: true })
    writeFileSync(join(compiler, 'index.js'), "throw new Error('Unexpected compiler load')")

    for (const args of [['get'], ['tag'], ['assert-tag', 'v0.6.1_0'], ['check', '--identity-only']]) {
      expect(repo.bump(...args).status).toBe(0)
    }
    expect(repo.bump('check').output).toContain('Unexpected compiler load')
  })

  it('refuses to bump outside Git even when the local migration is empty', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    rmSync(join(repo.root, '.git'), { recursive: true })
    const snapshot = repo.snapshot()

    const result = repo.bump('bump', 'minor', '--notes', 'Feature release.')
    expect(result.status).toBe(1)
    expect(result.output).toContain('requires a Git repository')
    expect(repo.snapshot()).toBe(snapshot)
  })
})
