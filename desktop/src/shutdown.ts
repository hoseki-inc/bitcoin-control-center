/** Give local services time to drain, without letting an unresponsive request prevent Quit. */
export async function shutdownWithDeadline(cleanup: () => Promise<void>, forceExit: () => void): Promise<void> {
  const deadline = setTimeout(forceExit, 10_000)
  try {
    await cleanup()
  } finally {
    clearTimeout(deadline)
  }
}
