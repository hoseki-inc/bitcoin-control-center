import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createQuitHandler } from '../src/shutdown.ts'

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

void test('waits for the server before stopping Tor and resuming quit', async () => {
  let finish
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  const harness = createHarness({ shutdownServer: () => pending })
  harness.requestQuit()
  assert.deepEqual(harness.calls, ['server'])
  assert.equal(harness.prevented, 1)
  assert.equal(harness.exits, 0)
  finish()
  await harness.exited
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'quit'])
  assert.equal(harness.exits, 1)
})

void test('repeated quit requests cannot bypass or duplicate pending cleanup', async () => {
  let finish
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  const harness = createHarness({ shutdownServer: () => pending })
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
  void test(`continues cleanup and quits after a failure in ${failingStep}`, async () => {
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

void test('forces quit after ten seconds when the server never settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness({ shutdownServer: () => new Promise(() => {}) })
  harness.requestQuit()
  t.mock.timers.tick(9_999)
  harness.requestQuit()
  assert.equal(harness.exits, 0)
  assert.deepEqual(harness.calls, ['server'])
  t.mock.timers.tick(1)
  await harness.exited
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'force-quit'])
  assert.equal(harness.exits, 1)
})

for (const rejects of [false, true]) {
  void test(`ignores a late server ${rejects ? 'rejection' : 'completion'} after forced exit`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let resolve, reject
    const pending = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const harness = createHarness({ shutdownServer: () => pending })
    harness.requestQuit()
    t.mock.timers.tick(10_000)
    await harness.exited
    if (rejects) {
      reject(new Error('Late failure'))
    } else {
      resolve()
    }
    await new Promise((done) => setImmediate(done))
    assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'force-quit'])
    assert.equal(harness.exits, 1)
  })
}

void test('clears the deadline after a normal shutdown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()
  harness.requestQuit()
  await harness.exited
  t.mock.timers.tick(10_000)
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'quit'])
  assert.equal(harness.exits, 1)
})

void test('still forces exit when cleanup throws after the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness({
    shutdownServer: () => new Promise(() => {}),
    stopTor: () => {
      throw new Error('Cleanup failed')
    },
  })
  harness.requestQuit()
  t.mock.timers.tick(10_000)
  await harness.exited
  assert.deepEqual(harness.calls, ['server', 'tor', 'tray', 'force-quit'])
  assert.equal(harness.exits, 1)
})
