/** What the desktop window may ask of the app about its PIN. */
export interface DesktopPinApi {
  /**
   * Asks the operating system to confirm a computer administrator, then clears the PIN (keeping all data) and
   * restarts. False if the prompt is cancelled or refused.
   */
  resetPin: () => Promise<boolean>
  /** Calls back once an administrator has confirmed, just before the restart. Returns a function that stops listening. */
  onResetting: (listener: () => void) => () => void
  /** Calls back when the window closes. Returns a function that stops listening. */
  onLock: (listener: () => void) => () => void
}
