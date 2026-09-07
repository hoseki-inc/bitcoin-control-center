import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const DESKTOP_DIR = path.resolve(__dirname, '..', '..')
  const REPO_ROOT = path.resolve(DESKTOP_DIR, '..')
  const appDir = path.join(DESKTOP_DIR, 'app')

  // The development launcher uses the downloaded binaries directly. As with the
  // staged installer copies, unsigned ARM64 Mach-O files cannot run on macOS.
  const torDir = path.join(DESKTOP_DIR, 'tor', 'mac')
  if (process.platform === 'darwin' && fs.existsSync(path.join(torDir, 'tor'))) {
    const libraries = fs.readdirSync(torDir).filter((name) => name.endsWith('.dylib'))
    for (const name of [...libraries, 'tor']) {
      execFileSync('codesign', ['--force', '--sign', '-', path.join(torDir, name)], { stdio: 'inherit' })
      execFileSync('codesign', ['--verify', '--strict', path.join(torDir, name)], { stdio: 'inherit' })
    }
  }

  // Generated packaging input must not retain files from an older build.
  fs.rmSync(appDir, { recursive: true, force: true })

  const shared: esbuild.BuildOptions = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    sourcemap: true,
    external: ['electron', '../server/*'],
  }

  // Build Electron main process
  await esbuild.build({
    ...shared,
    entryPoints: [path.join(DESKTOP_DIR, 'src/main.ts')],
    outfile: path.join(DESKTOP_DIR, 'app/main/index.js'),
  })

  await esbuild.build({
    ...shared,
    entryPoints: [path.join(DESKTOP_DIR, 'src/chooser-preload.ts')],
    outfile: path.join(appDir, 'main/chooser-preload.js'),
  })
  fs.copyFileSync(path.join(DESKTOP_DIR, 'src/chooser.html'), path.join(appDir, 'main/chooser.html'))
  fs.mkdirSync(path.join(appDir, 'resources'), { recursive: true })
  fs.copyFileSync(path.join(DESKTOP_DIR, 'resources/icon.png'), path.join(appDir, 'resources/tray-icon.png'))

  // Copy api-sentinel build output
  const serverDir = path.join(DESKTOP_DIR, 'app', 'server')
  fs.mkdirSync(serverDir, { recursive: true })
  fs.cpSync(path.join(REPO_ROOT, 'apps/api-sentinel/dist'), serverDir, { recursive: true })

  // Copy Control Center build output as public/ (served by api-sentinel's Fastify static)
  const publicDir = path.join(serverDir, 'public')
  fs.cpSync(path.join(REPO_ROOT, 'apps/control-center/dist'), publicDir, { recursive: true })

  // Copy api-sentinel assets
  const assetsSource = path.join(REPO_ROOT, 'apps/api-sentinel/assets')
  if (fs.existsSync(assetsSource)) {
    fs.cpSync(assetsSource, path.join(serverDir, 'assets'), { recursive: true })
  }

  console.log('Desktop build complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
