import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'

const repository = fileURLToPath(new URL('../', import.meta.url))
let fixture: string
const scopes = ['apps/control-center', 'packages/ui', '.ladle']
async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    rmSync(fixture, { recursive: true, force: true })
  })
  fixture = realpathSync(mkdtempSync(join(tmpdir(), 'bcc-oxlint-')))
  symlinkSync(join(repository, 'tools'), join(fixture, 'tools'), 'junction')
  for (const scope of scopes) {
    mkdirSync(join(fixture, scope), { recursive: true })
  }
  for (const name of ['.oxlintrc.json', '.oxlintrc.imports.json', 'packages/pdf/.oxlintrc.json']) {
    const destination = join(fixture, name)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(repository, name), destination)
  }
  const config = join(fixture, '.oxlintrc.json')
  writeFileSync(config, readFileSync(config, 'utf8').replace('"typeAware": true', '"typeAware": false'))

  await run()
}

it.each(scopes)('checks Chakra images and native interaction semantics inside %s', async (scope) => {
  await withTestSetup(async () => {
    const path = join(fixture, scope, 'probe.jsx')
    writeFileSync(
      path,
      'import { Image, Box } from "@chakra-ui/react"; export const Probe = () => <><Image src="image.png" /><Box as="img" src="image.png" /><Box onClick={() => {}}>Open</Box><Box as="button" onClick={() => {}}>Open</Box></>',
    )
    const result = spawnSync(
      process.execPath,
      [resolve(repository, 'node_modules/oxlint/bin/oxlint'), '--format', 'unix', path],
      {
        cwd: fixture,
        encoding: 'utf8',
        timeout: 15000,
      },
    )
    expect(result.stdout.match(/jsx-a11y\(alt-text\)/g), result.stdout).toHaveLength(2)
    expect(result.stdout.match(/jsx-a11y\(click-events-have-key-events\)/g), result.stdout).toHaveLength(1)
    expect(result.stdout.match(/jsx-a11y\(no-static-element-interactions\)/g), result.stdout).toHaveLength(1)
  })
})
it('keeps PDF-renderer Image components outside the browser mappings', async () => {
  await withTestSetup(async () => {
    const path = join(fixture, 'packages/pdf/probe.jsx')
    writeFileSync(
      path,
      'import { Image } from "@react-pdf/renderer"; export const Probe = () => <Image src="image.png" />',
    )
    const result = spawnSync(
      process.execPath,
      [resolve(repository, 'node_modules/oxlint/bin/oxlint'), '--format', 'unix', path],
      {
        cwd: fixture,
        encoding: 'utf8',
        timeout: 15000,
      },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('Failed')
    expect(result.stdout).not.toContain('jsx-a11y(alt-text)')
    expect(result.error).toBeUndefined()
  })
})

it('still checks native HTML inside the PDF directory', async () => {
  await withTestSetup(async () => {
    const path = join(fixture, 'packages/pdf/native-probe.jsx')
    writeFileSync(path, 'export const Probe = () => <img src="image.png" />')
    const result = spawnSync(
      process.execPath,
      [resolve(repository, 'node_modules/oxlint/bin/oxlint'), '--format', 'unix', path],
      { cwd: fixture, encoding: 'utf8', timeout: 15000 },
    )
    expect(result.stdout.match(/jsx-a11y\(alt-text\)/g), result.stdout).toHaveLength(1)
  })
})

it.each([
  'apps/control-center/src/components/accessible-cards.test.ts',
  'apps/control-center/src/components/claims/claim-selection.test.ts',
  'apps/control-center/src/pages/multisig/[id]/signing.test.ts',
  'packages/ui/design-system/forms/bitcoin-input-form-fields.test.tsx',
])('recognizes the test API used in %s', async (relativePath) => {
  await withTestSetup(async () => {
    const path = join(fixture, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      readFileSync(join(repository, relativePath), 'utf8') +
        "\nit.only('focused probe', () => {})\nit.skip('skipped probe', () => {})\nit.for([1])('parameterized probe', () => {})\n",
    )
    const result = spawnSync(
      process.execPath,
      [resolve(repository, 'node_modules/oxlint/bin/oxlint'), '--format', 'unix', path],
      { cwd: fixture, encoding: 'utf8', timeout: 15000 },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout, result.stderr).toContain('vitest(no-focused-tests)')
    expect(result.stdout, result.stderr).toContain('vitest(no-disabled-tests)')
    expect(result.stdout, result.stderr).toContain('vitest(consistent-each-for)')
  })
})

it('sorts named imports after setup without applying unrelated fixes', async () => {
  await withTestSetup(async () => {
    const path = join(fixture, 'packages/pdf/probe.ts')
    const source = [
      'const setup = true',
      "import { zebra as last, type Apple as First } from 'example'",
      'export function probe(): void { if (setup) last() }',
      '',
    ].join('\n')
    writeFileSync(path, source)
    const result = spawnSync(
      process.execPath,
      [resolve(repository, 'node_modules/oxlint/bin/oxlint'), '--config', '.oxlintrc.imports.json', '--fix', path],
      { cwd: fixture, encoding: 'utf8', timeout: 15000 },
    )
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(
      source.replace('zebra as last, type Apple as First', 'type Apple as First, zebra as last'),
    )
  })
})

it('asks for a textStyle instead of raw font sizes on components, but not on SVG text', async () => {
  await withTestSetup(async () => {
    const path = join(fixture, 'apps/control-center/font-probe.jsx')
    writeFileSync(
      path,
      'import { Text, chakra } from "@chakra-ui/react"; export const Probe = () => <><Text fontSize="sm">a</Text><chakra.span lineHeight="20px">b</chakra.span><svg><text fontSize={12}>c</text></svg><Text textStyle="text/sm">d</Text></>',
    )
    const result = spawnSync(
      process.execPath,
      [resolve(repository, 'node_modules/oxlint/bin/oxlint'), '--format', 'unix', path],
      { cwd: fixture, encoding: 'utf8', timeout: 15000 },
    )
    expect(result.stdout.match(/control-center\(use-text-style\)/g), result.stdout).toHaveLength(2)
  })
})

// Code outside a feature folder may import only the folder itself, which resolves to its index.ts.
const featureBoundaryProbes = {
  allowed: {
    'apps/api-sentinel/src/context.ts': "import { EtfService } from './features/etf'",
    'apps/api-sentinel/src/features/etf/router.ts': "import { EtfService } from './service'",
    'apps/api-sentinel/src/features/etf/holdings/rows.ts': "import { EtfService } from '../service'",
    'apps/api-sentinel/src/features/index.ts': "import { etfRouter } from './etf'",
    'apps/api-sentinel/src/modules/probe/named-index.ts': "import { EtfService } from '../../features/etf/index'",
    'apps/api-sentinel/src/modules/probe/named-index-file.ts':
      "import { EtfService } from '../../features/etf/index.ts'",
    'apps/control-center/src/alias-door.ts': "import { EtfPage } from '@hoseki/apps/control-center/src/features/etf'",
    'apps/control-center/src/package.ts': "import { z } from 'zod'",
  },
  blocked: {
    'apps/api-sentinel/src/modules/probe/plain.ts': "import { EtfService } from '../../features/etf/service'",
    'apps/api-sentinel/src/features/etf/sibling.ts': "import { PriceService } from '../price/service'",
    'apps/api-sentinel/src/modules/probe/type-only.ts': "import type { EtfService } from '../../features/etf/service'",
    'apps/api-sentinel/src/modules/probe/re-export.ts': "export { etfRouter } from '../../features/etf/router'",
    'apps/api-sentinel/src/modules/probe/export-all.ts': "export * from '../../features/etf/router'",
    'apps/api-sentinel/src/modules/probe/dynamic.ts': "export const load = () => import('../../features/etf/router')",
    'apps/api-sentinel/src/modules/probe/import-type.ts':
      "export type Service = import('../../features/etf/service').EtfService",
    'apps/api-sentinel/src/modules/probe/mock.test.ts': "vi.mock('../../features/etf/service')",
    'apps/api-sentinel/src/modules/probe/folder.ts': "import { Rows } from '../../features/etf/holdings'",
    'apps/control-center/src/alias.ts':
      "import { EtfService } from '@hoseki/apps/api-sentinel/src/features/etf/service'",
    'apps/control-center/src/features/etf/other-app.ts':
      "import { EtfService } from '@hoseki/apps/api-sentinel/src/features/etf/service'",
  },
}

it('lets code outside a feature import only its index.ts', async () => {
  await withTestSetup(async () => {
    const probes = { ...featureBoundaryProbes.allowed, ...featureBoundaryProbes.blocked }
    for (const [relativePath, source] of Object.entries(probes)) {
      const path = join(fixture, relativePath)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${source}\n`)
    }
    const result = spawnSync(
      process.execPath,
      [
        resolve(repository, 'node_modules/oxlint/bin/oxlint'),
        '--format',
        'unix',
        ...Object.keys(probes).map((relativePath) => join(fixture, relativePath)),
      ],
      { cwd: fixture, encoding: 'utf8', timeout: 15000 },
    )
    const reported = result.stdout
      .split('\n')
      .filter((line) => line.includes('control-center(feature-boundary)'))
      .map((line) => line.slice(0, line.indexOf(':')))
    expect(result.error).toBeUndefined()
    expect(reported.sort(), result.stdout + result.stderr).toEqual(Object.keys(featureBoundaryProbes.blocked).sort())
  })
})

it('keeps the feature boundary on: no disable comment names it or switches off every rule', () => {
  const rule = ['feature', 'boundary'].join('-')
  const disable = '(oxlint|eslint)-disable(-next-line|-line)?'
  const result = spawnSync(
    'git',
    ['grep', '-n', '-E', '-e', `${disable}.*${rule}`, '-e', `${disable}[[:space:]]*(\\*/|--|$)`],
    { cwd: repository, encoding: 'utf8' },
  )
  expect(result.error).toBeUndefined()
  expect(result.stdout).toBe('')
  expect(result.status).toBe(1)
})
