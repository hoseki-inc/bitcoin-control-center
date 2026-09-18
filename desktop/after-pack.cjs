const { join } = require('node:path')
const { signTorBinaries } = require('./scripts/sign-tor.cjs')

/**
 * Sign the staged Tor copies before electron-builder performs final app signing.
 * @param {import('app-builder-lib').PackContext} context
 * @returns {Promise<void>}
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  signTorBinaries(
    join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'tor'),
  )
}
