/**
 * Desktop distribution flag, also enabled by the browser desktop preview.
 * Gates Electrum and Tor settings managed by StartOS in the node distribution.
 * The backend separately opts into saved connections; this flag cannot enable
 * Electron-managed Tor or native wallet integration in a regular browser.
 */
export const isDesktop: boolean = import.meta.env['VITE_PLATFORM'] === 'desktop'
