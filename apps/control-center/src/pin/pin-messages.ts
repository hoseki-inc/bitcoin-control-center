import type { PinPlatform } from './actions'

export function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function waitMessage(ms: number): string {
  return `Too many wrong PINs. Try again in ${formatWait(ms)}.`
}

export function wrongPinMessage(freeAttemptsLeft: number): string {
  if (freeAttemptsLeft > 0 && freeAttemptsLeft <= 2) {
    return `Wrong PIN. ${freeAttemptsLeft} more ${freeAttemptsLeft === 1 ? 'try' : 'tries'} before a short wait.`
  }
  return 'Wrong PIN. Try again.'
}

export const MISMATCH_MESSAGE = 'Those PINs didn’t match. Choose your PIN again.'
export const UNREACHABLE_MESSAGE = 'Couldn’t reach Control Center. Try again.'
export const SIGN_OUT_FAILED_MESSAGE = 'Couldn’t sign out everywhere. Try again.'

/** How someone who forgets the PIN gets back in decides what the Save step says. */
export function saveMessage(platform: PinPlatform): string {
  switch (platform) {
    case 'umbrel':
      return 'Keep it in your password manager. If you forget it, you’ll need to reset it from the umbrelOS terminal.'
    case 'desktop':
      return 'Keep it in your password manager. If you forget it, you’ll need this computer’s administrator password to reset it.'
    case 'startos':
      return 'Keep it in your password manager.'
  }
}

export const UMBREL_RESET_COMMAND = 'sudo docker exec bitcoin-control-center_web_1 node /app/dist/cli.js reset-pin'
