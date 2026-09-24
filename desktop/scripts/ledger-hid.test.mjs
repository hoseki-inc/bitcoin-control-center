import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { setupLedgerHidAccess } from '../src/ledger-hid.ts'

/** @typedef {(event: unknown, ...args: unknown[]) => unknown} InvokeHandler */

const APP_ORIGIN = 'http://localhost:3400'
const ledger = { vendorId: 0x2c97, deviceId: 'ledger-1', name: 'Flex', serialNumber: 'private-serial' }
const secondLedger = { ...ledger, deviceId: 'ledger-2', name: 'Nano X' }
const otherDevice = { vendorId: 0x1234, deviceId: 'other-1', name: 'Other device' }

/**
 * @param {import('node:test').TestContext} t
 * @param {(options: import('electron').MessageBoxOptions) => Promise<{ response: number }>} choose
 */
function createHarness(t, choose = async () => ({ response: 0 })) {
  const session = new EventEmitter()
  const frame = { url: `${APP_ORIGIN}/claims/verify/ledger` }
  /** @type {import('../src/ledger-hid-api').LedgerHidUpdate[]} */
  const updates = []
  const contents = Object.assign(new EventEmitter(), {
    session,
    mainFrame: frame,
    isDestroyed: () => false,
    /** @param {string} channel @param {import('../src/ledger-hid-api').LedgerHidUpdate} update */
    send: (channel, update) => {
      assert.equal(channel, 'ledger-hid:update')
      updates.push(update)
    },
  })
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false })
  /** @type {Map<string, InvokeHandler>} */
  const handlers = new Map()
  const ipc = Object.assign(new EventEmitter(), {
    /** @param {string} channel @param {InvokeHandler} handler */
    handle: (channel, handler) => handlers.set(channel, handler),
    /** @param {string} channel */
    removeHandler: (channel) => handlers.delete(channel),
  })
  /** @param {string} channel */
  function getHandler(channel) {
    const handler = handlers.get(channel)
    assert.ok(handler, `Missing IPC handler: ${channel}`)
    return handler
  }
  const sender = { sender: contents, senderFrame: frame }
  /** @type {import('electron').MessageBoxOptions[]} */
  const dialogs = []
  setupLedgerHidAccess(window, APP_ORIGIN, ipc, async (parent, options) => {
    assert.equal(parent, window)
    dialogs.push(options)
    return choose(options)
  })
  t.after(() => window.emit('closed'))
  /** @returns {Promise<string | undefined>} */
  async function request(overrides = {}) {
    let calls = 0
    let prevented = false
    return new Promise((resolve) => {
      session.emit(
        'select-hid-device',
        { preventDefault: () => (prevented = true) },
        { frame, deviceList: [ledger], ...overrides },
        /** @param {string | undefined} deviceId */
        (deviceId) => {
          assert.equal(prevented, true)
          assert.equal(++calls, 1)
          resolve(deviceId)
        },
      )
    })
  }
  return {
    request,
    dialogs,
    lastUpdate: () => {
      const update = updates.at(-1)
      assert.ok(update, 'Expected a Ledger device update')
      return update
    },
    frame,
    contents,
    window,
    session,
    ipc,
    handlers,
    sender,
    begin: (id = 'request-1', event = sender) => getHandler('ledger-hid:begin')(event, id),
    select: (deviceId, id = 'request-1', event = sender) => getHandler('ledger-hid:choose')(event, id, deviceId),
    cancel: (id = 'request-1', event = sender) => ipc.emit('ledger-hid:cancel', event, id),
    end: (id = 'request-1', event = sender) => ipc.emit('ledger-hid:end', event, id),
    /** @param {typeof ledger | typeof otherDevice} device */
    add: (device, deviceFrame = frame) => session.emit('hid-device-added', {}, { frame: deviceFrame, device }),
    /** @param {typeof ledger | typeof otherDevice} device */
    remove: (device) => session.emit('hid-device-removed', {}, { frame, device }),
  }
}

for (const url of ['https://example.com', 'http://localhost:3401', 'http://localhost:3400.evil.test', 'not a URL']) {
  void test(`rejects device and IPC requests from ${url}`, async (t) => {
    const h = createHarness(t)
    h.frame.url = url
    assert.equal(h.begin(), false)
    assert.equal(await h.request(), undefined)
    assert.equal(h.dialogs.length, 0)
  })
}

void test('rejects null, child and other-window frames and IPC senders', async (t) => {
  const h = createHarness(t)
  for (const frame of [null, { url: h.frame.url }]) {
    assert.equal(await h.request({ frame }), undefined)
    assert.equal(h.begin('request-1', { sender: h.contents, senderFrame: frame }), false)
  }
  assert.equal(h.begin('request-1', { sender: {}, senderFrame: h.frame }), false)
})

void test('one Ledger connects after explicit Connect, without a native picker', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = createHarness(t)
  assert.equal(h.begin(), true)
  const result = h.request()
  assert.equal(h.lastUpdate().status, 'connecting')
  t.mock.timers.tick(150)
  assert.equal(await result, ledger.deviceId)
  assert.equal(h.lastUpdate().status, 'connecting')
  assert.equal(h.dialogs.length, 0)
})

void test('multiple devices require a choice and expose only Ledger names and IDs', async (t) => {
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [otherDevice, ledger, secondLedger] })
  assert.deepEqual(h.lastUpdate().devices, [
    { id: 'ledger-1', name: 'Flex' },
    { id: 'ledger-2', name: 'Nano X' },
  ])
  assert.equal(h.select(otherDevice.deviceId), false)
  assert.equal(h.select(secondLedger.deviceId), true)
  assert.equal(await result, secondLedger.deviceId)
})

void test('empty discovery stays open, then connects a hotplugged Ledger', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [] })
  assert.deepEqual(h.lastUpdate().devices, [])
  h.add(otherDevice)
  assert.deepEqual(h.lastUpdate().devices, [])
  h.add(ledger)
  t.mock.timers.tick(150)
  assert.equal(await result, ledger.deviceId)
})

void test('simultaneous hotplug requires selection instead of choosing whichever arrived first', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [] })
  h.add(ledger)
  h.add(secondLedger)
  t.mock.timers.tick(150)
  assert.equal(h.lastUpdate().status, 'choosing')
  h.select(secondLedger.deviceId)
  assert.equal(await result, secondLedger.deviceId)
})

void test('removal updates the list and prevents selecting a disconnected device', async (t) => {
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [ledger, secondLedger] })
  h.remove(ledger)
  assert.deepEqual(h.lastUpdate().devices, [{ id: 'ledger-2', name: 'Nano X' }])
  assert.equal(h.select(ledger.deviceId), false)
  assert.equal(h.select(secondLedger.deviceId), true)
  assert.equal(await result, secondLedger.deviceId)
})

void test('stale request IDs, malformed IDs and spoofed senders cannot select or cancel', async (t) => {
  const h = createHarness(t)
  assert.equal(h.begin({}), false)
  assert.equal(h.begin(), true)
  assert.equal(h.begin('another-request'), false)
  const result = h.request({ deviceList: [ledger, secondLedger] })
  assert.equal(h.select(ledger.deviceId, 'old-request'), false)
  assert.equal(h.select({}, 'request-1'), false)
  assert.equal(h.select(ledger.deviceId, 'request-1', { sender: {}, senderFrame: h.frame }), false)
  h.cancel('old-request')
  assert.equal(h.select(secondLedger.deviceId), true)
  assert.equal(await result, secondLedger.deviceId)
})

void test('cancel resolves the pending request once and allows retry', async (t) => {
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [] })
  h.cancel()
  h.cancel()
  assert.equal(await result, undefined)
  assert.equal(h.lastUpdate().status, 'cancelled')
  assert.equal(h.begin('retry'), true)
})

void test('late events from another frame cannot change the pending list', async (t) => {
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [] })
  h.add(ledger, { url: h.frame.url })
  assert.deepEqual(h.lastUpdate().devices, [])
  h.cancel()
  assert.equal(await result, undefined)
})

void test('navigation cancels pending permission and stale choices are rejected', async (t) => {
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [ledger, secondLedger] })
  h.contents.emit('did-start-navigation', { isMainFrame: true })
  assert.equal(await result, undefined)
  assert.equal(h.select(ledger.deviceId), false)
})

void test('checks the origin again before automatic selection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = createHarness(t)
  h.begin()
  const result = h.request()
  h.frame.url = 'https://example.com'
  t.mock.timers.tick(150)
  assert.equal(await result, undefined)
})

void test('requests expire with a distinct state and can be retried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [] })
  t.mock.timers.tick(120_000)
  assert.equal(await result, undefined)
  assert.equal(h.lastUpdate().status, 'expired')
  assert.equal(h.begin('retry'), true)
})

void test('window closure cancels a pending request and cleans up IPC and device listeners', async (t) => {
  const h = createHarness(t)
  h.begin()
  const result = h.request({ deviceList: [] })
  h.window.emit('closed')
  assert.equal(await result, undefined)
  assert.equal(h.handlers.size, 0)
  for (const event of ['select-hid-device', 'hid-device-added', 'hid-device-removed']) {
    assert.equal(h.session.listenerCount(event), 0)
  }
  assert.equal(h.ipc.listenerCount('ledger-hid:cancel'), 0)
  assert.equal(h.ipc.listenerCount('ledger-hid:end'), 0)
})

void test('other connection entry points retain the scoped native chooser', async (t) => {
  const h = createHarness(t, async () => ({ response: 1 }))
  assert.equal(await h.request({ deviceList: [otherDevice, ledger, secondLedger] }), secondLedger.deviceId)
  const dialog = h.dialogs[0]
  assert.ok(dialog, 'Expected a Ledger device chooser')
  assert.deepEqual(dialog.buttons, ['Flex', 'Nano X', 'Cancel'])
})

void test('native chooser cancellation and errors do not grant access', async (t) => {
  const cancelled = createHarness(t, async (options) => ({ response: options.cancelId }))
  assert.equal(await cancelled.request(), undefined)
  const failed = createHarness(t, async () => {
    throw new Error('Closed')
  })
  assert.equal(await failed.request(), undefined)
})

void test('native fallback rechecks the requesting page after selection', async (t) => {
  const h = createHarness(t, async () => {
    h.frame.url = 'https://example.com'
    return { response: 0 }
  })
  assert.equal(await h.request(), undefined)
})

void test('a late browser event after Cancel is denied without reopening a native chooser', async (t) => {
  const h = createHarness(t)
  h.begin()
  h.cancel()
  assert.equal(h.begin('retry-before-settlement'), false)
  assert.equal(await h.request(), undefined)
  assert.equal(h.dialogs.length, 0)
  assert.equal(h.begin('retry'), true)
})

void test('renderer settlement releases a reservation when no browser request was issued', async (t) => {
  const h = createHarness(t)
  h.begin()
  h.cancel()
  h.end('old-request')
  h.end('request-1', { sender: {}, senderFrame: h.frame })
  assert.equal(h.begin('retry'), false)
  h.end()
  assert.equal(h.begin('retry'), true)
})

void test('expiration before the browser event also denies the late request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = createHarness(t)
  h.begin()
  t.mock.timers.tick(120_000)
  assert.equal(h.lastUpdate().status, 'expired')
  assert.equal(await h.request(), undefined)
  assert.equal(h.dialogs.length, 0)
  assert.equal(h.begin('retry'), true)
})

void test('same-origin navigation cancels a native chooser immediately and ignores its late result', async (t) => {
  let finishDialog
  const h = createHarness(
    t,
    async () =>
      new Promise((resolve) => {
        finishDialog = resolve
      }),
  )
  const result = h.request()
  assert.equal(h.begin(), false)
  assert.equal(await h.request(), undefined)
  assert.equal(h.dialogs.length, 1)
  h.contents.emit('did-start-navigation', { isMainFrame: true })
  h.frame.url = `${APP_ORIGIN}/accounts`
  assert.equal(await result, undefined)
  const signal = h.dialogs[0]?.signal
  assert.ok(signal, 'Expected a device chooser abort signal')
  assert.equal(signal.aborted, true)
  assert.equal(h.begin('next-page'), true)
  finishDialog({ response: 0 })
  await Promise.resolve()
  assert.equal(h.select(ledger.deviceId, 'next-page'), false)
  assert.equal(h.begin('another-request'), false)
})

void test('native chooser timeout releases its callback even if the dialog promise stays pending', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = createHarness(t, async () => new Promise(() => undefined))
  const result = h.request()
  t.mock.timers.tick(120_000)
  assert.equal(await result, undefined)
  const signal = h.dialogs[0]?.signal
  assert.ok(signal, 'Expected a device chooser abort signal')
  assert.equal(signal.aborted, true)
  assert.equal(h.begin('retry'), true)
})

void test('native selection cannot grant a device removed while the dialog was open', async (t) => {
  let finishDialog
  const h = createHarness(
    t,
    async () =>
      new Promise((resolve) => {
        finishDialog = resolve
      }),
  )
  const result = h.request()
  h.remove(ledger)
  finishDialog({ response: 0 })
  assert.equal(await result, undefined)
})

for (const event of ['closed', 'render-process-gone']) {
  void test(`${event} cancels and closes a native chooser`, async (t) => {
    const h = createHarness(t, async () => new Promise(() => undefined))
    const result = h.request()
    ;(event === 'closed' ? h.window : h.contents).emit(event)
    assert.equal(await result, undefined)
    const signal = h.dialogs[0]?.signal
    assert.ok(signal, 'Expected a device chooser abort signal')
    assert.equal(signal.aborted, true)
  })
}
