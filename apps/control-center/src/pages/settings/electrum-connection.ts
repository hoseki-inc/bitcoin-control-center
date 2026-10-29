import { TRPCClientError } from '@trpc/client'

/** Where and how to reach an Electrum server. */
export interface ConnectionDetails {
  host: string
  port: number
  protocol: 'ssl' | 'tcp'
  torEnabled: boolean
}

/** Blockstream's public Electrum server, which the desktop app starts on. */
export const PUBLIC_ELECTRUM_HOST = 'electrum.blockstream.info'

/** A new connection starts as SSL on Electrum's usual SSL port, without Tor. */
export function blankConnection(): ConnectionDetails {
  return { host: '', port: 50002, protocol: 'ssl', torEnabled: false }
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535
}

/** Onion addresses are only reachable through Tor. */
export function isOnionHost(host: string): boolean {
  return host.trim().toLowerCase().replace(/\.$/, '').endsWith('.onion')
}

/** Shows Sentinel's own error message; anything else, such as an unreadable response, gets a plain one. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Caught errors are untrusted and narrowed here.
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof TRPCClientError && error.shape != null ? error.message : fallback
}
