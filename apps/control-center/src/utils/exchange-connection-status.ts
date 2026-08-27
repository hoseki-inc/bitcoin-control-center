export type ExchangeConnectionStatus = 'connected' | 'needs_reconnect'

interface ExchangeConnectionState {
  connectionStatus?: ExchangeConnectionStatus | null
}

export function needsExchangeReconnect(account: ExchangeConnectionState): boolean {
  return account.connectionStatus === 'needs_reconnect'
}

export function isExchangeConnected(account: ExchangeConnectionState): boolean {
  return !needsExchangeReconnect(account)
}
