import { stat } from 'node:fs/promises'

const requiredFiles = ['README.md', 'instructions.md']

for (const file of requiredFiles) {
  const path = new URL(`../${file}`, import.meta.url)

  try {
    const fileStat = await stat(path)
    if (!fileStat.isFile() || fileStat.size === 0) {
      throw new Error('file is empty or is not a regular file')
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Required StartOS package file ${file} is unavailable: ${reason}`)
  }
}

console.log(`StartOS package files OK: ${requiredFiles.join(', ')}`)
