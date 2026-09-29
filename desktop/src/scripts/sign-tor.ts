import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Tor's expert bundle is unsigned, and Apple Silicon refuses unsigned Mach-O
 * files even in local builds without a Developer ID. Apply ad-hoc signatures.
 * @param {string} directory
 * @returns {void}
 */
export function signTorBinaries(directory: string): void {
  const libraries = readdirSync(directory).filter((name) => name.endsWith('.dylib'))
  for (const name of [...libraries, 'tor']) {
    const binary = join(directory, name)
    execFileSync('codesign', ['--force', '--sign', '-', binary], { stdio: 'inherit' })
    execFileSync('codesign', ['--verify', '--strict', binary], { stdio: 'inherit' })
  }
}

/**
 * electron-builder signs `mac.binaries` with the release identity, so that list
 * must name every Mach-O file in the Tor bundle. Fail packaging with a clear fix
 * when a Tor update changes them, such as a new libevent version.
 * @param {string} directory
 * @param {readonly string[]} configured
 * @returns {void}
 */
export function checkMacTorBinaries(directory: string, configured: readonly string[]): void {
  const prefix = 'Contents/Resources/tor/'
  const bundled = ['tor', ...readdirSync(directory).filter((name) => name.endsWith('.dylib'))]
    .map((name) => `${prefix}${name}`)
    .sort((a, b) => a.localeCompare(b))
  const listed = configured.filter((file) => file.startsWith(prefix)).sort((a, b) => a.localeCompare(b))
  if (bundled.join('\n') !== listed.join('\n')) {
    throw new Error(
      `Update mac.binaries in desktop/electron-builder.yml to match the bundled Tor files: ${bundled.join(', ')}`,
    )
  }
}
