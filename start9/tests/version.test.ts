import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

const script = fileURLToPath(new URL('../scripts/version.mjs', import.meta.url))
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
  write: (file: string, contents: string) => void
  read: (file: string) => string
  remove: (file: string) => void
  exists: (file: string) => boolean
  release: (tag: string) => void
  bump: (...args: string[]) => { status: number | null; output: string }
}

/** A throwaway repository holding the version script, with tagged releases. */
function setupRepository(): Repository {
  const root = mkdtempSync(join(tmpdir(), 'startos-version-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const versions = join(root, 'start9', 'startos', 'versions')
  mkdirSync(versions, { recursive: true })
  mkdirSync(join(root, 'start9', 'scripts'))
  copyFileSync(script, join(root, 'start9', 'scripts', 'version.mjs'))
  // Ignore the developer's git configuration, such as commit signing.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
      cwd: root,
      env,
      stdio: 'ignore',
    })
  }
  git('init', '-q')
  return {
    write: (file, contents) => {
      writeFileSync(join(versions, file), contents)
    },
    read: (file) => readFileSync(join(versions, file), 'utf8'),
    remove: (file) => {
      rmSync(join(versions, file))
    },
    exists: (file) => existsSync(join(versions, file)),
    release: (tag) => {
      git('add', '-A')
      git('commit', '-q', '-m', tag)
      git('tag', tag)
    },
    bump: (...args) => {
      const result = spawnSync(process.execPath, [join(root, 'start9', 'scripts', 'version.mjs'), ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
      })
      return { status: result.status, output: `${result.stdout}${result.stderr}` }
    },
  }
}

describe('bumping past a migration', () => {
  it('carries a migration added since the last release into the new version', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    repo.release('v0.6.1_0')
    repo.write('current.ts', versionFile('current', '0.6.1:0', migration))

    const result = repo.bump('bump', 'patch', '--notes', 'Next release.')

    expect(result).toMatchObject({ status: 0 })
    expect(result.output).toContain('carried the unreleased migration into 0.6.2:0')
    expect(repo.read('current.ts')).toBe(
      versionFile('current', '0.6.1:0', migration)
        .replace("version: '0.6.1:0'", "version: '0.6.2:0'")
        .replace(/releaseNotes: `[^`]*`/, 'releaseNotes: "Next release."'),
    )
    expect(repo.exists('v0.6.1_0.ts')).toBe(false)
    expect(repo.read('index.ts')).toBe(index)
  })

  it('reads releases tagged before the current.ts layout', () => {
    const repo = setupRepository()
    repo.write('index.ts', index.replaceAll('current', 'v0_6_0_1'))
    repo.write('v0_6_0_1.ts', versionFile('v0_6_0_1', '0.6.0:1'))
    repo.release('v0.6.0_1')
    repo.remove('v0_6_0_1.ts')
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.0:1', migration))

    const result = repo.bump('bump', 'revision')

    expect(result).toMatchObject({ status: 0 })
    expect(repo.read('current.ts')).toContain("version: '0.6.0:2'")
    expect(repo.read('current.ts')).toContain('await seed(effects)')
  })

  it('moves a migration that shipped with the last release into its own version file', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0', migration))
    repo.release('v0.6.1_0')

    const result = repo.bump('bump', 'patch', '--notes', 'Next release.')

    expect(result).toMatchObject({ status: 0 })
    expect(result.output).toContain('moved the 0.6.1:0 migration to v0.6.1_0.ts')
    expect(repo.read('v0.6.1_0.ts')).toBe(versionFile('v_0_6_1_0', '0.6.1:0', migration))
    expect(repo.read('index.ts')).toContain("import { v_0_6_1_0 } from './v0.6.1_0'")
    expect(repo.read('index.ts')).toContain('other: [v_0_6_1_0]')
    expect(repo.read('current.ts')).toContain("version: '0.6.2:0'")
    expect(repo.read('current.ts')).toContain('migrations: {}')
    expect(repo.bump('check')).toMatchObject({ status: 0 })
  })

  it('moves a shipped migration out and carries its replacement into the new version', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0', migration))
    repo.release('v0.6.1_0')
    const replacement = migration.replace('seed(effects)', 'reseed(effects)')
    repo.write('current.ts', versionFile('current', '0.6.1:0', replacement))

    const result = repo.bump('bump', 'patch', '--notes', 'Next release.')

    expect(result).toMatchObject({ status: 0 })
    expect(result.output).toContain(
      'moved the 0.6.1:0 migration to v0.6.1_0.ts; carried the unreleased migration into 0.6.2:0',
    )
    expect(repo.read('v0.6.1_0.ts')).toBe(versionFile('v_0_6_1_0', '0.6.1:0', migration))
    expect(repo.read('current.ts')).toContain("version: '0.6.2:0'")
    expect(repo.read('current.ts')).toContain('await reseed(effects)')
    expect(repo.bump('check')).toMatchObject({ status: 0 })
  })

  it('treats a reformatted shipped migration as shipped, not new', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0', migration))
    repo.release('v0.6.1_0')
    const reformatted = `{ up: async ({ effects, }) => { await seed(effects); }, // seeds
  }`
    repo.write('current.ts', versionFile('current', '0.6.1:0', reformatted))

    const result = repo.bump('bump', 'patch')

    expect(result).toMatchObject({ status: 0 })
    expect(result.output).not.toContain('carried')
    expect(repo.read('v0.6.1_0.ts')).toBe(versionFile('v_0_6_1_0', '0.6.1:0', migration))
    expect(repo.read('current.ts')).toContain('migrations: {}')
  })

  it('still moves out a shipped migration that was cleared from current.ts by hand', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0', migration))
    repo.release('v0.6.1_0')
    repo.write('current.ts', versionFile('current', '0.6.1:0'))

    expect(repo.bump('bump', 'patch')).toMatchObject({ status: 0 })
    expect(repo.read('v0.6.1_0.ts')).toBe(versionFile('v_0_6_1_0', '0.6.1:0', migration))
  })

  it('finds a migration even when the release notes look like an empty one', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))
    repo.release('v0.6.1_0')
    const misleading = versionFile('current', '0.6.1:0', migration).replace(
      'Notes for 0.6.1:0.',
      'Notes mentioning migrations: {} in passing.',
    )
    repo.write('current.ts', misleading)

    const result = repo.bump('bump', 'patch')

    expect(result).toMatchObject({ status: 0 })
    expect(result.output).toContain('carried the unreleased migration into 0.6.2:0')
    expect(repo.read('current.ts')).toContain('await seed(effects)')
  })

  it('refuses rather than guessing when the release tag is missing', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0', migration))

    const result = repo.bump('bump', 'patch')

    expect(result.status).toBe(1)
    expect(result.output).toContain('tag v0.6.1_0 is not available')
    expect(result.output).toContain('publish the v0.6.1_0 draft release')
    expect(repo.read('current.ts')).toBe(versionFile('current', '0.6.1:0', migration))
  })

  it('bumps in place without consulting git when there is no migration', () => {
    const repo = setupRepository()
    repo.write('index.ts', index)
    repo.write('current.ts', versionFile('current', '0.6.1:0'))

    expect(repo.bump('bump', 'minor', '--notes', 'Feature release.')).toMatchObject({ status: 0 })
    expect(repo.read('current.ts')).toContain("version: '0.7.0:0'")
  })
})
