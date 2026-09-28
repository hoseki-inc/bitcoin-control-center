/** Distinguish an unreachable server from a request rejected by the server. */
export function queryErrorMessage(error: { message: string } | null | undefined, fallback: string): string {
  if (error && /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(error.message)) {
    return "Can't connect to Control Center's local server. Check that Control Center is running, then try again."
  }
  return fallback
}
