import { create } from 'zustand'

export type PinPlatform = 'startos' | 'umbrel' | 'desktop'

/** Sentinel's answer about this tab, with any wrong-PIN delay as the time it ends on this computer's clock. */
export type PinStatus =
  | { platform: null }
  | { platform: PinPlatform; state: 'insecure' | 'no-pin' | 'signed-out' | 'signed-in'; retryAt: number | null }

/**
 * `checking`: waiting for Sentinel's first answer. `closed`: only a PIN screen is mounted. `revealing`: signed in;
 * the app renders under the finished check, then the screen fades away. `open`: the app alone. `covering`: a lock
 * screen is fading in over the app, which unmounts once it's covered.
 */
export type Phase = 'checking' | 'closed' | 'revealing' | 'open' | 'covering'

export interface Gate {
  /** Counts locks. Work that started before the latest lock (a PIN check, setup, a reveal) is dropped. */
  readonly epoch: number
  readonly phase: Phase
  /** The epoch in which this tab set the first PIN, which keeps setup on screen through its Save step. */
  readonly setupEpoch: number | null
}

export type GateEvent =
  /** Sentinel answered a status check that started while the gate was `asked`. */
  | { type: 'answered'; status: PinStatus; asked: Gate }
  /** `once` closes the app in the same render, with no fade. */
  | { type: 'lock'; at: 'fade' | 'once' }
  | { type: 'pin-set' | 'reveal' | 'revealed'; epoch: number }
  | { type: 'covered' }

export type Screen = 'loading' | 'unreachable' | 'setup' | 'startos' | 'insecure' | 'sign-in'

export const INITIAL_GATE: Gate = { epoch: 0, phase: 'checking', setupEpoch: null }

export function appMounted(phase: Phase): boolean {
  return phase === 'revealing' || phase === 'open' || phase === 'covering'
}

/** Only Sentinel's first answer, or a finished reveal, opens the app. A lock always wins. */
export function nextGate(gate: Gate, event: GateEvent): Gate {
  switch (event.type) {
    case 'answered':
      // With PINs off there's nothing to lock, so the app opens even after a lock that came before the answer.
      if (event.status.platform === null) {
        return { ...gate, phase: 'open' }
      }
      if (gate.phase !== 'checking' || event.asked.epoch !== gate.epoch) {
        return gate
      }
      return { ...gate, phase: event.status.state === 'signed-in' ? 'open' : 'closed' }
    case 'lock': {
      const fades = event.at === 'fade' && (gate.phase === 'open' || gate.phase === 'covering')
      return { ...gate, epoch: gate.epoch + 1, phase: fades ? 'covering' : 'closed' }
    }
    case 'covered':
      return gate.phase === 'covering' ? { ...gate, phase: 'closed' } : gate
    // These belong to the epoch they started in; a lock since then drops them.
    case 'pin-set':
      return event.epoch === gate.epoch ? { ...gate, setupEpoch: event.epoch } : gate
    case 'reveal':
      return event.epoch === gate.epoch && gate.phase === 'closed' ? { ...gate, phase: 'revealing' } : gate
    case 'revealed':
      return event.epoch === gate.epoch && gate.phase === 'revealing'
        ? { ...gate, phase: 'open', setupEpoch: null }
        : gate
  }
}

/** The PIN screen over (or instead of) the app, or null when the app shows alone. */
export function screenFor(status: PinStatus | 'loading' | 'failed', gate: Gate): Screen | null {
  if (gate.phase === 'open') {
    return null
  }
  if (status === 'loading') {
    return 'loading'
  }
  // Without an answer it's unknown whether a PIN is needed, so the app stays closed until Sentinel replies.
  if (status === 'failed') {
    return 'unreachable'
  }
  if (status.platform === null) {
    return null
  }
  if (gate.setupEpoch === gate.epoch) {
    return 'setup'
  }
  if (status.state === 'insecure') {
    return 'insecure'
  }
  if (status.state === 'no-pin') {
    return status.platform === 'startos' ? 'startos' : 'setup'
  }
  return 'sign-in'
}

/** A later status check found the open app's session gone (Sentinel restarted, say), so the app locks. */
export function endsSession(gate: Gate, asked: Gate, status: PinStatus): boolean {
  return (
    gate.phase === 'open' &&
    asked.phase === 'open' &&
    asked.epoch === gate.epoch &&
    status.platform !== null &&
    status.state !== 'signed-in'
  )
}

export const useGate = create<Gate>(() => INITIAL_GATE)

export function dispatch(event: GateEvent): void {
  useGate.setState((gate) => nextGate(gate, event), true)
}

export function currentEpoch(): number {
  return useGate.getState().epoch
}
