import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test, vi } from 'vitest'
import { createQuitHandler } from '../src/shutdown.ts'

/** @param {import('vitest').TestContext} t */
function useFakeTimers(t) {
  // Restore timers for this test even if it fails or times out.
  t.onTestFinished(() => {
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

/** @param {Partial<Parameters<typeof createQuitHandler>[0]>} overrides */
function createHarness(overrides = {}) {
  const app = new EventEmitter()
  const calls = []
  let prevented = 0
  let exits = 0
  /** @type {() => void} */
  let resolveExit
  /** @type {Promise<void>} */
  const exited = new Promise((resolve) => {
    resolveExit = resolve
  })
  const requestQuit = () => {
    let canceled = false
    const isCanceled = () => canceled
    app.emit('before-quit', {
      preventDefault: () => {
        canceled = true
        prevented++
      },
    })
    if (!isCanceled()) {
      exits++
      resolveExit()
    }
  }
  app.on(
    'before-quit',
    createQuitHandler({
      shutdownServer: async () => {
        calls.push('server')
        await overrides.shutdownServer?.()
      },
      stopTor: () => {
        calls.push('tor')
        overrides.stopTor?.()
      },
      destroyTray: () => {
        calls.push('tray')
        overrides.destroyTray?.()
      },
      reportError: () => {
        calls.push('error')
      },
      quit: () => {
        calls.push('quit')
        requestQuit()
      },
      forceQuit: () => {
        calls.push('force-quit')
        exits++
        resolveExit()
      },
    }),
  )
  return {
    calls,
    requestQuit,
    exited,
    get prevented() {
      return prevented
    },
    get exits() {
      return exits
    },
  }
}

test('waits for the server before stopping Tor and resuming quit', async () => {
  let finish
  /** @type {Promise<void>} */
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  const harness = createHarness({ shutdownServer: async () => pending })
  harness.requestQuit()
  assert.deepEqual(harness.calls, ['server'])
  assert.equal(harness.prevented, 1)
  assert.equal(harness.exits, 0)
  finish()
  await harness.exited
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'quit'])
  assert.equal(harness.exits, 1)
})

test('repeated quit requests cannot bypass or duplicate pending cleanup', async () => {
  let finish
  /** @type {Promise<void>} */
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  const harness = createHarness({ shutdownServer: async () => pending })
  harness.requestQuit()
  harness.requestQuit()
  harness.requestQuit()
  assert.deepEqual(harness.calls, ['server'])
  assert.equal(harness.prevented, 3)
  assert.equal(harness.exits, 0)
  finish()
  await harness.exited
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'quit'])
  assert.equal(harness.exits, 1)
})

for (const failingStep of ['shutdownServer', 'stopTor', 'destroyTray']) {
  test(`continues cleanup and quits after a failure in ${failingStep}`, async () => {
    const harness = createHarness({
      [failingStep]: () => {
        throw new Error('Synthetic cleanup failure')
      },
    })
    harness.requestQuit()
    await harness.exited
    assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'error', 'quit'])
    assert.equal(harness.exits, 1)
  })
}

test('forces quit after ten seconds when the server never settles', async (t) => {
  useFakeTimers(t)
  const harness = createHarness({ shutdownServer: async () => new Promise(() => {}) })
  harness.requestQuit()
  vi.advanceTimersByTime(9_999)
  harness.requestQuit()
  assert.equal(harness.exits, 0)
  assert.deepEqual(harness.calls, ['server'])
  vi.advanceTimersByTime(1)
  await harness.exited
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'force-quit'])
  assert.equal(harness.exits, 1)
})

for (const rejects of [false, true]) {
  test(`ignores a late server ${rejects ? 'rejection' : 'completion'} after forced exit`, async (t) => {
    useFakeTimers(t)
    let resolve, reject
    /** @type {Promise<void>} */
    const pending = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const harness = createHarness({ shutdownServer: async () => pending })
    harness.requestQuit()
    vi.advanceTimersByTime(10_000)
    await harness.exited
    if (rejects) {
      reject(new Error('Late failure'))
    } else {
      resolve()
    }
    await new Promise((done) => {
      setImmediate(done)
    })
    assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'force-quit'])
    assert.equal(harness.exits, 1)
  })
}

test('clears the deadline after a normal shutdown', async (t) => {
  useFakeTimers(t)
  const harness = createHarness()
  harness.requestQuit()
  await harness.exited
  vi.advanceTimersByTime(10_000)
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'quit'])
  assert.equal(harness.exits, 1)
})

test('still forces exit when cleanup throws after the deadline', async (t) => {
  useFakeTimers(t)
  const harness = createHarness({
    shutdownServer: async () => new Promise(() => {}),
    stopTor: () => {
      throw new Error('Cleanup failed')
    },
  })
  harness.requestQuit()
  vi.advanceTimersByTime(10_000)
  await harness.exited
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'force-quit'])
  assert.equal(harness.exits, 1)
})
