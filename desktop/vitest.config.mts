import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  test: { environment: 'node', include: ['scripts/*.test.mjs', 'tests/**/*.test.ts'] },
})
