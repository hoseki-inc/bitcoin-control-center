import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@hoseki/packages': fileURLToPath(new URL('../../packages', import.meta.url)),
      '@hoseki/apps': fileURLToPath(new URL('../../apps', import.meta.url)),
    },
  },
  test: { include: ['*.test.ts'] },
})
