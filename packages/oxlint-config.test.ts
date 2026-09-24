import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../', import.meta.url))
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'bcc-oxlint-')))
const scopes = ['apps/control-center', 'packages/ui', 'packages/pdf/preview', '.ladle']
beforeAll(() => {
  for (const scope of scopes) {
    mkdirSync(join(fixture, scope), { recursive: true })
  }
  for (const name of ['.oxlintrc.json', 'packages/pdf/.oxlintrc.json', 'packages/pdf/preview/.oxlintrc.json']) {
    const destination = join(fixture, name)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(repository, name), destination)
  }
  // These fixtures test JSX configuration, not TypeScript project loading.
  const config = join(fixture, '.oxlintrc.json')
  writeFileSync(config, readFileSync(config, 'utf8').replace('"typeAware": true', '"typeAware": false'))
})
afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
})
it.each(scopes)('checks Chakra images and native interaction semantics inside %s', (scope) => {
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
it('keeps PDF-renderer Image components outside the browser mappings', () => {
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

it('still checks native HTML inside the PDF directory', () => {
  const path = join(fixture, 'packages/pdf/native-probe.jsx')
  writeFileSync(path, 'export const Probe = () => <img src="image.png" />')
  const result = spawnSync(
    process.execPath,
    [resolve(repository, 'node_modules/oxlint/bin/oxlint'), '--format', 'unix', path],
    { cwd: fixture, encoding: 'utf8', timeout: 15000 },
  )
  expect(result.stdout.match(/jsx-a11y\(alt-text\)/g), result.stdout).toHaveLength(1)
})
