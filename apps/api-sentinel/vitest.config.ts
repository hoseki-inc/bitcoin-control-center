import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@hoseki/packages': fileURLToPath(new URL('../../packages', import.meta.url)) },
  },
  test: { include: ['src/**/*.test.ts'] },
})
