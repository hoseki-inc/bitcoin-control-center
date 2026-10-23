/**
 * Development only: `localStorage.setItem('dev:latency-ms', '1500')` delays every request to Sentinel by
 * about that long, as opening the app over Tor does. Production builds drop this, as `import.meta.env.DEV`
 * is false there.
 */
export function developmentFetch(): typeof fetch | undefined {
  if (!import.meta.env.DEV) {
    return undefined
  }
  return async (input, init) => {
    const latencyMs = readLatencyMs()
    if (latencyMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, latencyMs * (0.75 + Math.random() / 2))
      })
    }
    return fetch(input, init)
  }
}

function readLatencyMs(): number {
  try {
    const latencyMs = Number(localStorage.getItem('dev:latency-ms'))
    return Number.isFinite(latencyMs) ? latencyMs : 0
  } catch {
    // Storage can be unavailable, such as in private windows.
    return 0
  }
}
