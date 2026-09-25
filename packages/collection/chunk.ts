export function chunk<T>(iter: Iterable<T>, size: number): T[][] {
  const chunks: T[][] = []
  let i = 0
  let j = 0
  for (const value of iter) {
    if (i < size) {
      i += 1
    } else {
      i = 1
      j += 1
    }
    const currentChunk = chunks[j] ?? []
    chunks[j] = currentChunk
    currentChunk.push(value)
  }
  return chunks
}
