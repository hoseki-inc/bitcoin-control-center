/// <reference types='vitest' />
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => {
  return {
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/apps/control-center',

    resolve: {
      alias: {
        '@hoseki/packages': resolve(import.meta.dirname, '../../packages'),
      },
    },

    server: {
      port: 4269,
      host: 'localhost',
      fs: {
        strict: false,
      },
    },

    preview: {
      port: 4300,
      host: 'localhost',
    },

    plugins: [
      react(),
      nodePolyfills({
        // The browser application only needs Buffer. Limiting the plugin keeps
        // unrelated Node shims such as vm-browserify out of the production
        // bundle.
        include: ['buffer'],
        globals: {
          Buffer: true,
        },
      }),
    ],

    build: {
      outDir: 'dist',
      reportCompressedSize: true,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },

    test: {
      globals: true,
      environment: 'node',
      env: loadEnv(mode, process.cwd(), ''),
      include: ['src/**/*.test.ts'],
      reporters: ['default'],
      passWithNoTests: true,
    },
  }
})
