interface QuitEvent {
  preventDefault: () => void
}

interface ShutdownOptions {
  shutdownServer: () => Promise<void>
  stopTor: () => void
  destroyTray: () => void
  reportError: () => void
  quit: () => void
  forceQuit: () => void
}

export function createQuitHandler({
  shutdownServer,
  stopTor,
  destroyTray,
  reportError,
  quit,
  forceQuit,
}: ShutdownOptions): (event: QuitEvent) => void {
  let started = false
  let completed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function finish(force: boolean, failed = false): void {
    if (completed) {
      return
    }
    completed = true
    clearTimeout(timer)
    for (const cleanup of [stopTor, destroyTray]) {
      try {
        cleanup()
      } catch {
        failed = true
      }
    }
    try {
      if (failed && !force) {
        reportError()
      }
    } finally {
      if (force) {
        forceQuit()
      } else {
        quit()
      }
    }
  }

  async function shutdown(): Promise<void> {
    let failed = false
    try {
      await shutdownServer()
    } catch {
      failed = true
    }
    finish(false, failed)
  }

  return (event) => {
    if (completed) {
      return
    }
    event.preventDefault()
    if (started) {
      return
    }
    started = true
    // A stalled request must not keep the desktop app alive indefinitely.
    timer = setTimeout(() => {
      finish(true)
    }, 10_000)
    void shutdown()
  }
}
