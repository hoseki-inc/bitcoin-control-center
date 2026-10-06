import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(
  ({ mode }) =>
    ({
      root: import.meta.dirname,
      oxc: { jsx: { runtime: 'automatic' } },
      cacheDir: '../node_modules/.vite/packages',
      plugins: [react()],

      resolve: {
        alias: {
          '@hoseki/packages': resolve(import.meta.dirname, '.'),
        },
      },

      test: {
        globals: true,
        environment: 'node',
        include: ['./**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        reporters: ['default'],
        coverage: { reportsDirectory: '../coverage/packages', provider: 'v8' },
        env: loadEnv(mode, process.cwd(), ''),
      },
    }) as const,
)
