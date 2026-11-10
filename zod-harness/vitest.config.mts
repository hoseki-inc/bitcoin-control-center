import { relative, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const root = resolve(import.meta.dirname, '..')

// Registers every top-level const of a Zod-importing source module, so schemas that are not exported
// (form schemas, response schemas) can be recorded and replayed without touching production code.
function registerTopLevelConsts(): Plugin {
  return {
    name: 'zod-harness-register',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!/\.(ts|tsx)$/.test(file) || file.includes('node_modules') || file.includes('/zod-harness/')) return
      if (!/from 'zod'/.test(code)) return
      const names = [...code.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/gm)].map((m) => m[1])
      if (names.length === 0) return
      const key = JSON.stringify(relative(root, file))
      const getters = [...new Set(names)].map(
        (n) => `${n}: (() => { try { return ${n} } catch { return undefined } })()`,
      )
      return `${code}\n;Reflect.get(globalThis, "__zodHarness")?.(${key}, () => ({ ${getters.join(', ')} }));\n`
    },
  }
}

export default defineConfig({
  root,
  plugins: [registerTopLevelConsts(), react()],
  resolve: {
    alias: {
      '@hoseki/packages': resolve(root, 'packages'),
      '@hoseki/apps': resolve(root, 'apps'),
    },
  },
  test: {
    include: ['zod-harness/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['apps/api-sentinel/src/no-network.setup.ts'],
    testTimeout: 600_000,
  },
})
