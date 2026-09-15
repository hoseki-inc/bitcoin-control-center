// The preload exposes only this narrow device-selection API, never raw Electron IPC.
export type LedgerHidUpdate = {
  requestId: string
  status: 'choosing' | 'connecting' | 'cancelled' | 'expired'
  devices: { id: string; name: string }[]
}

export type LedgerHidApi = {
  begin: (requestId: string) => Promise<boolean>
  choose: (requestId: string, deviceId: string) => Promise<boolean>
  cancel: (requestId: string) => void
  end: (requestId: string) => void
  subscribe: (listener: (update: LedgerHidUpdate) => void) => () => void
}
