import { join } from 'node:path'
import { checkMacTorBinaries, signTorBinaries } from './src/scripts/sign-tor.ts'

/**
 * Sign the staged Tor copies before electron-builder performs final app signing.
 * @param {import('app-builder-lib').PackContext} context
 * @returns {Promise<void>}
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }
  const torDirectory = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'tor',
  )
  checkMacTorBinaries(torDirectory, context.packager.config.mac?.binaries ?? [])
  signTorBinaries(torDirectory)
}
