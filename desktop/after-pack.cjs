const { execFileSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Tor's expert bundle is unsigned. Apple Silicon requires at least an ad-hoc
 * signature, including in local builds without a Developer ID. Sign the staged
 * copies before electron-builder performs final app signing, never the downloads.
 * @param {import('app-builder-lib').PackContext} context
 * @returns {Promise<void>}
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const directory = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'tor',
  )
  const binaries = readdirSync(directory).filter((name) => name.endsWith('.dylib'))
  for (const name of [...binaries, 'tor']) {
    const binary = join(directory, name)
    execFileSync('codesign', ['--force', '--sign', '-', binary], { stdio: 'inherit' })
    execFileSync('codesign', ['--verify', '--strict', binary], { stdio: 'inherit' })
  }
}
