/**
 * Ranks how well a query matches a command, from 0 (no match) to 1 (exact).
 * Exact and prefix matches beat word-start matches, which beat substrings, which beat
 * letters found in order ("stmt" finds "Statements").
 */
export function scoreText(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  const t = text.toLowerCase()
  if (q === '') return 1
  if (t === q) return 1
  if (t.startsWith(q)) return 0.9
  const words = t.split(/[\s\-_/·,.]+/)
  if (words.some((word) => word.startsWith(q))) return 0.8
  if (q.includes(' ') && q.split(/\s+/).every((part) => words.some((word) => word.startsWith(part)))) return 0.75
  if (t.includes(q)) return 0.6
  // Letters in order, with a penalty for how spread out they are.
  let from = 0
  let first = -1
  for (const char of q) {
    const at = t.indexOf(char, from)
    if (at === -1) return 0
    if (first === -1) first = at
    from = at + 1
  }
  const span = from - first
  return Math.max(0.1, 0.4 * (q.length / span))
}

export interface Searchable {
  label: string
  /** Extra words that should find this command without showing in its label. */
  keywords?: readonly string[]
}

/** Best score across a command's label and keywords; keywords count a little less. */
export function scoreCommand(query: string, command: Searchable): number {
  const label = scoreText(query, command.label)
  const keyword = Math.max(0, ...(command.keywords ?? []).map((word) => scoreText(query, word) * 0.9))
  return Math.max(label, keyword)
}

/** Commands that match, best first; ties keep their original order. */
export function rankCommands<T extends Searchable>(query: string, commands: readonly T[]): T[] {
  if (query.trim() === '') return [...commands]
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(query, command) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ command }) => command)
}
