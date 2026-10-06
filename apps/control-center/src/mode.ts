/**
 * Desktop flag. True in the Electron desktop build and the `pnpm dev:desktop` preview.
 * Gates Electrum server settings, saved connections, and Tor, which StartOS
 * configures at the OS level.
 */
export const isDesktop: boolean = import.meta.env['VITE_PLATFORM'] === 'desktop'
