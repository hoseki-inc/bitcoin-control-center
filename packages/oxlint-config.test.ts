import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'

const repository = fileURLToPath(new URL('../', import.meta.url))
let fixture: string
const scopes = ['apps/control-center', 'packages/ui', 'packages/pdf/preview', '.ladle']
async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    rmSync(fixture, { recursive: true, force: true })
  })
  fixture = realpathSync(mkdtempSync(join(tmpdir(), 'bcc-oxlint-')))
  for (const scope of scopes) {
    mkdirSync(join(fixture, scope), { recursive: true })
  }
  for (const name of ['.oxlintrc.json', 'packages/pdf/.oxlintrc.json', 'packages/pdf/preview/.oxlintrc.json']) {
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
