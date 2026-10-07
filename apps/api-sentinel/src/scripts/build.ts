import { cpSync, rmSync } from 'node:fs'
import * as esbuild from 'esbuild'

rmSync('dist', { recursive: true, force: true })

const shared: esbuild.BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: true,
  // Provide CJS globals for packages bundled into ESM output.
  banner: {
    js: [
      "import { createRequire as __sentinelCreateRequire } from 'node:module';",
      "import { fileURLToPath as __sentinelFileURLToPath } from 'node:url';",
      "import { dirname as __sentinelDirname } from 'node:path';",
      'const require = __sentinelCreateRequire(import.meta.url);',
      'const __filename = __sentinelFileURLToPath(import.meta.url);',
      'const __dirname = __sentinelDirname(__filename);',
    ].join(' '),
  },
  // Only keep native/complex packages external — bundle everything else
  external: ['@libsql/client', '@react-pdf/renderer', 'react', 'react-dom', 'yoga-layout'],
}

// cli.ts — self-starting entry point for standalone / Docker / Start9
await esbuild.build({
  ...shared,
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
})

// main.ts — library export for Electron (exports main() and SentinelServer)
await esbuild.build({
  ...shared,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
})

// Ship migration files alongside the bundled server for Drizzle's native migrator.
cpSync('drizzle', 'dist/drizzle', { recursive: true, force: true })
