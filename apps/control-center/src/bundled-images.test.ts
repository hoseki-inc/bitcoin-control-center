import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const repo = join(import.meta.dirname, '../../..')
const publicDir = join(repo, 'apps/control-center/public')
// oxlint-disable-next-line control-center/no-remote-assets -- the host this test looks for.
const remoteAssetHost = 'assets.hoseki.app'
const imagePath = /['"`](\/[\w./-]+\.(?:svg|png|avif|jpe?g|webp))['"`]/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(path)
    }
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// Sentinel answers a missing file with index.html, so a wrong path draws a broken image instead of failing.
it('finds every image the UI loads by path in apps/control-center/public', () => {
  const missing = [join(repo, 'apps/control-center/src'), join(repo, 'packages')].flatMap(sourceFiles).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(imagePath)]
      .map((match) => match[1] ?? '')
      .filter((path) => !existsSync(join(publicDir, path)))
      .map((path) => `${relative(repo, file)}: ${path}`),
  )
  expect(missing).toEqual([])
})

// The lint rule control-center/no-remote-assets covers scripts; this covers the markup, styles and data next to them.
it('loads nothing from the asset CDN in HTML, CSS or JSON', () => {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages', 'desktop', 'start9'],
    { cwd: repo, encoding: 'utf8' },
  )
    .split('\n')
    .filter((file) => /\.(?:html|css|json)$/.test(file) && !file.endsWith('package-lock.json'))
  expect(files.length).toBeGreaterThan(0)
  const remote = files.filter(
    (file) => existsSync(join(repo, file)) && readFileSync(join(repo, file), 'utf8').includes(remoteAssetHost),
  )
  expect(remote).toEqual([])
})
