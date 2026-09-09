import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { setupLedgerHidAccess } from '../src/ledger-hid.ts'

const APP_ORIGIN = 'http://localhost:3400'
const ledger = { vendorId: 0x2c97, deviceId: 'ledger-1', name: 'Flex' }
const otherDevice = { vendorId: 0x1234, deviceId: 'other-1', name: 'Other device' }

function createHarness(choose = async () => ({ response: 0 })) {
  const session = new EventEmitter()
  const frame = { url: `${APP_ORIGIN}/claims/verify/ledger` }
  const contents = { session, mainFrame: frame, isDestroyed: () => false }
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false })
  const dialogs = []
  setupLedgerHidAccess(window, APP_ORIGIN, async (parent, options) => {
    assert.equal(parent, window)
    dialogs.push(options)
    return choose(options)
  })

  function request(overrides = {}) {
    const details = { frame, deviceList: [ledger], ...overrides }
    let prevented = false
    let callbackCount = 0
    const result = new Promise((resolve) => {
      session.emit('select-hid-device', { preventDefault: () => (prevented = true) }, details, (deviceId) => {
        assert.equal(prevented, true)
        assert.equal(++callbackCount, 1)
        resolve(deviceId)
      })
    })
    return result
  }

  return { request, dialogs, frame, window, contents, session }
}

test('offers only Ledger devices and grants the selected device', async () => {
  const secondLedger = { ...ledger, deviceId: 'ledger-2', name: 'Nano X' }
  const h = createHarness(async () => ({ response: 1 }))
  assert.equal(await h.request({ deviceList: [otherDevice, ledger, secondLedger] }), 'ledger-2')
  assert.deepEqual(h.dialogs[0].buttons, ['Flex', 'Nano X', 'Cancel'])
  assert.equal(h.dialogs[0].cancelId, 2)
})

test('canceling the chooser does not grant device access', async () => {
  const h = createHarness(async (options) => ({ response: options.cancelId }))
  assert.equal(await h.request(), undefined)
})

test('does not grant access before the user chooses', async () => {
  let choose
  const h = createHarness(() => new Promise((resolve) => (choose = resolve)))
  let resolved = false
  const result = h.request().then((device) => {
    resolved = true
    return device
  })
  await Promise.resolve()
  assert.equal(resolved, false)
  choose({ response: 0 })
  assert.equal(await result, ledger.deviceId)
})

for (const url of ['https://example.com', 'http://localhost:3401', 'http://localhost:3400.evil.test', 'not a URL']) {
  test(`rejects requests from ${url}`, async () => {
    const h = createHarness()
    h.frame.url = url
    assert.equal(await h.request(), undefined)
    assert.equal(h.dialogs.length, 0)
  })
}

test('rejects missing frames and same-origin child frames or other windows', async () => {
  const h = createHarness()
  assert.equal(await h.request({ frame: null }), undefined)
  assert.equal(await h.request({ frame: { url: h.frame.url } }), undefined)
  assert.equal(h.dialogs.length, 0)
})

test('cancels when no Ledger is available', async () => {
  const h = createHarness()
  assert.equal(await h.request({ deviceList: [] }), undefined)
  assert.equal(await h.request({ deviceList: [otherDevice] }), undefined)
  assert.equal(h.dialogs.length, 0)
})

test('cancels if the page navigates away while the chooser is open', async () => {
  const h = createHarness(async () => {
    h.frame.url = 'https://example.com'
    return { response: 0 }
  })
  assert.equal(await h.request(), undefined)
})

test('cancels if the window is destroyed while the chooser is open', async () => {
  const h = createHarness(async () => {
    h.window.isDestroyed = () => true
    return { response: 0 }
  })
  assert.equal(await h.request(), undefined)
})

test('cancels if the native chooser fails', async () => {
  const h = createHarness(async () => {
    throw new Error('Chooser closed')
  })
  assert.equal(await h.request(), undefined)
})

test('removes the session listener when the window closes', () => {
  const h = createHarness()
  assert.equal(h.session.listenerCount('select-hid-device'), 1)
  h.window.emit('closed')
  assert.equal(h.session.listenerCount('select-hid-device'), 0)
})
