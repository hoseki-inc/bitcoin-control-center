const { execFileSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Tor's expert bundle is unsigned, and Apple Silicon refuses unsigned Mach-O
 * files even in local builds without a Developer ID. Apply ad-hoc signatures.
 * @param {string} directory
 * @returns {void}
 */
function signTorBinaries(directory) {
  const libraries = readdirSync(directory).filter((name) => name.endsWith('.dylib'))
  for (const name of [...libraries, 'tor']) {
    const binary = join(directory, name)
    execFileSync('codesign', ['--force', '--sign', '-', binary], { stdio: 'inherit' })
    execFileSync('codesign', ['--verify', '--strict', binary], { stdio: 'inherit' })
  }
}

module.exports = { signTorBinaries }
