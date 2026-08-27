/**
 * Desktop-specific flag. True only in the Electron desktop build.
 * Used to gate features like Electrum server settings and Tor that
 * don't apply to Start9 (which configures these at the OS level).
 */
export const isDesktop: boolean = import.meta.env['VITE_PLATFORM'] === 'desktop'
