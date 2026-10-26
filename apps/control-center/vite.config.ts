import { execFileSync } from 'node:child_process'
/// <reference types='vitest' />
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// The shared release version, like 1.1.0, so the help link can say which release a click came from.
function releaseVersion(): string {
  try {
    const script = resolve(import.meta.dirname, '../../start9/scripts/version.mjs')
    return execFileSync(process.execPath, [script, 'umbrel'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

export default defineConfig(({ mode }) => {
  return {
    root: import.meta.dirname,
    define: {
      'import.meta.env.VITE_RELEASE_VERSION': JSON.stringify(releaseVersion()),
    },
    cacheDir: '../../node_modules/.vite/apps/control-center',

    resolve: {
      alias: {
        '@hoseki/packages': resolve(import.meta.dirname, '../../packages'),
        'lottie-react': resolve(import.meta.dirname, '../../node_modules/lottie-react/build/index.es.js'),
        'react-canvas-confetti/dist/presets/fireworks': resolve(
          import.meta.dirname,
          '../../node_modules/react-canvas-confetti/src/presets/fireworks/index.tsx',
        ),
      },
    },

    server: {
      // Sentinel's development CORS allows only this port, so fail rather than move to another one.
      port: 4269,
      strictPort: true,
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
        // The browser application only needs Buffer and stream. Limiting the plugin keeps
        // unrelated Node shims such as vm-browserify out of the production
        // bundle.
        include: ['buffer', 'stream'],
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
      include: ['src/**/*.test.{ts,tsx}'],
      reporters: ['default'],
      passWithNoTests: true,
    },
  }
})
