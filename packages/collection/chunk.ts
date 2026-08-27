// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const chunk = chunks[j] ?? []
    chunks[j] = chunk
    chunk.push(value)
  }
  return chunks
}
