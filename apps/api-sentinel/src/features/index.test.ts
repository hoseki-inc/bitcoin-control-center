import { readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import { featureRouters } from '.'

it('mounts a router for every feature folder, under the folder name', () => {
  const folders = readdirSync(new URL('.', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  expect(Object.keys(featureRouters).sort()).toEqual(folders)
})
