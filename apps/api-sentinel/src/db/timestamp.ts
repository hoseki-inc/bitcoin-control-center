const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/

/**
 * SQLite's `datetime('now')` writes UTC as `YYYY-MM-DD HH:MM:SS` with no zone, which `new Date` reads
 * as local time. Marks that text as UTC and passes ISO strings through unchanged.
 */
export function normalizeDbTimestamp(value: string): string {
  return SQLITE_DATETIME.test(value) ? `${value.replace(' ', 'T')}Z` : value
}

export function parseDbTimestamp(value: string): Date {
  return new Date(normalizeDbTimestamp(value))
}
