import { describe, expect, it } from 'vitest'
import { type Gate, INITIAL_GATE, type PinStatus, endsSession, nextGate, screenFor } from './gate'

const signedIn: PinStatus = { platform: 'umbrel', state: 'signed-in', retryAt: null }
const signedOut: PinStatus = { platform: 'umbrel', state: 'signed-out', retryAt: null }
const off: PinStatus = { platform: null }

function gate(phase: Gate['phase'], epoch = 0, setupEpoch: number | null = null): Gate {
  return { epoch, phase, setupEpoch }
}

describe('nextGate', () => {
  it('opens on the first answer only when signed in or PINs are off', () => {
    expect(nextGate(INITIAL_GATE, { type: 'answered', status: signedIn, asked: INITIAL_GATE }).phase).toBe('open')
    expect(nextGate(INITIAL_GATE, { type: 'answered', status: off, asked: INITIAL_GATE }).phase).toBe('open')
    expect(nextGate(INITIAL_GATE, { type: 'answered', status: signedOut, asked: INITIAL_GATE }).phase).toBe('closed')
  })

  it('ignores later answers, and answers to a check a lock overtook', () => {
    expect(nextGate(gate('closed'), { type: 'answered', status: signedIn, asked: gate('closed') })).toEqual(
      gate('closed'),
    )
    expect(nextGate(gate('revealing'), { type: 'answered', status: signedIn, asked: gate('closed') })).toEqual(
      gate('revealing'),
    )
    const locked = nextGate(INITIAL_GATE, { type: 'lock', at: 'fade' })
    expect(nextGate(locked, { type: 'answered', status: signedIn, asked: INITIAL_GATE })).toEqual(locked)
  })

  it('opens whenever Sentinel says PINs are off, even after a lock', () => {
    const locked = nextGate(INITIAL_GATE, { type: 'lock', at: 'once' })
    expect(nextGate(locked, { type: 'answered', status: off, asked: INITIAL_GATE })).toEqual(gate('open', 1))
  })

  it('locks from any phase, fading only over an open app', () => {
    expect(nextGate(gate('open'), { type: 'lock', at: 'fade' })).toEqual(gate('covering', 1))
    expect(nextGate(gate('covering', 1), { type: 'lock', at: 'fade' })).toEqual(gate('covering', 2))
    expect(nextGate(gate('open'), { type: 'lock', at: 'once' })).toEqual(gate('closed', 1))
    expect(nextGate(gate('revealing'), { type: 'lock', at: 'fade' })).toEqual(gate('closed', 1))
    expect(nextGate(gate('closed'), { type: 'lock', at: 'fade' })).toEqual(gate('closed', 1))
    expect(nextGate(INITIAL_GATE, { type: 'lock', at: 'fade' })).toEqual(gate('closed', 1))
  })

  it('reveals and opens only within the same epoch', () => {
    const revealing = nextGate(gate('closed', 2), { type: 'reveal', epoch: 2 })
    expect(revealing).toEqual(gate('revealing', 2))
    expect(nextGate(gate('closed', 2), { type: 'reveal', epoch: 1 })).toEqual(gate('closed', 2))
    expect(nextGate(gate('revealing', 2, 2), { type: 'revealed', epoch: 2 })).toEqual(gate('open', 2))
    expect(nextGate(gate('closed', 3), { type: 'revealed', epoch: 2 })).toEqual(gate('closed', 3))
  })

  it('records setup only for the current epoch', () => {
    expect(nextGate(gate('closed', 1), { type: 'pin-set', epoch: 1 }).setupEpoch).toBe(1)
    expect(nextGate(gate('closed', 2), { type: 'pin-set', epoch: 1 }).setupEpoch).toBeNull()
  })

  it('closes once the lock screen has covered the app', () => {
    expect(nextGate(gate('covering', 1), { type: 'covered' })).toEqual(gate('closed', 1))
    expect(nextGate(gate('open', 1), { type: 'covered' })).toEqual(gate('open', 1))
  })
})

describe('screenFor', () => {
  it('shows nothing over the open app, or while PINs are off', () => {
    expect(screenFor(signedOut, gate('open'))).toBeNull()
    expect(screenFor(off, gate('closed'))).toBeNull()
  })

  it('waits for Sentinel, and stays closed when it can’t be reached', () => {
    expect(screenFor('loading', INITIAL_GATE)).toBe('loading')
    expect(screenFor('failed', gate('closed'))).toBe('unreachable')
  })

  it('keeps setup on screen through its Save step and the reveal, until a lock', () => {
    expect(screenFor(signedIn, gate('closed', 1, 1))).toBe('setup')
    expect(screenFor(signedIn, gate('revealing', 1, 1))).toBe('setup')
    expect(screenFor(signedIn, gate('closed', 2, 1))).toBe('sign-in')
  })

  it('picks the screen from the status', () => {
    expect(screenFor({ platform: 'startos', state: 'insecure', retryAt: null }, gate('closed'))).toBe('insecure')
    expect(screenFor({ platform: 'startos', state: 'no-pin', retryAt: null }, gate('closed'))).toBe('startos')
    expect(screenFor({ platform: 'umbrel', state: 'no-pin', retryAt: null }, gate('closed'))).toBe('setup')
    expect(screenFor(signedOut, gate('closed'))).toBe('sign-in')
    // Signed in, but not opened yet: the sign-in screen stays through the reveal and over a covering app.
    expect(screenFor(signedIn, gate('revealing'))).toBe('sign-in')
    expect(screenFor(signedIn, gate('covering'))).toBe('sign-in')
  })
})

describe('endsSession', () => {
  it('locks an open app whose session Sentinel no longer has', () => {
    expect(endsSession(gate('open'), gate('open'), signedOut)).toBe(true)
    expect(endsSession(gate('open'), gate('open'), signedIn)).toBe(false)
    expect(endsSession(gate('open'), gate('open'), off)).toBe(false)
  })

  it('ignores an answer to a check that started before the app opened, or before a lock', () => {
    expect(endsSession(gate('open'), gate('closed'), signedOut)).toBe(false)
    expect(endsSession(gate('open', 1), gate('open', 0), signedOut)).toBe(false)
    expect(endsSession(gate('closed', 1), gate('open', 0), signedOut)).toBe(false)
  })
})
