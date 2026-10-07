// Writes Brotli and gzip copies of the web app's text files, which Sentinel serves to browsers
// that accept them. The main bundle is over 13 MB, slow to load over Tor without compression.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const compressible = /\.(css|html|ico|js|json|svg|ttf|txt)$/
const minimumBytes = 1024
const brotli = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

const [directory] = process.argv.slice(2)
if (directory === undefined || directory === '') {
  throw new Error('Usage: node compress-web-assets.mjs <web app directory>')
}

let original = 0
let compressed = 0
for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !compressible.test(entry.name)) {
    continue
  }
  const path = join(entry.parentPath, entry.name)
  const content = await readFile(path)
  if (content.length < minimumBytes) {
    continue
  }
  const [br, gz] = await Promise.all([
    brotli(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
      },
    }),
    gzipAsync(content, { level: constants.Z_BEST_COMPRESSION }),
  ])
  // A copy that is no smaller is not worth sending.
  if (br.length < content.length) {
    await writeFile(`${path}.br`, br)
  }
  if (gz.length < content.length) {
    await writeFile(`${path}.gz`, gz)
  }
  original += content.length
  compressed += Math.min(br.length, content.length)
}

const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`
console.log(`Compressed web assets: ${megabytes(original)} -> ${megabytes(compressed)} with Brotli`)
