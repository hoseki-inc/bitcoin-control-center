import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { type RouterOutput, baseTrpc, queryClient } from '../trpc'
import { useLockState } from './session'

export type PinStatus = RouterOutput['auth']['status']

export const PIN_STATUS_KEY = ['pin-status']

export function usePinStatus(): UseQueryResult<PinStatus> {
  return useQuery({
    queryKey: PIN_STATUS_KEY,
    queryFn: async () => baseTrpc.auth.status.query(),
    retry: false,
    refetchOnWindowFocus: true,
    // While StartOS has yet to set the PIN, notice when it does.
    refetchInterval: (data) => (data?.required === true && !data.pinSet && !data.inAppSetup ? 5000 : false),
  })
}

/** Drops everything the app has loaded, so nothing stays in memory behind the lock screen. */
export async function forgetLoadedData(): Promise<void> {
  const keep = (queryKey: readonly unknown[]): boolean => queryKey[0] === PIN_STATUS_KEY[0]
  await queryClient.cancelQueries({ predicate: (query) => !keep(query.queryKey) })
  queryClient.removeQueries({ predicate: (query) => !keep(query.queryKey) })
  queryClient.getMutationCache().clear()
}

/** Locks this tab: Sentinel ends its session, and the lock screen replaces the app. */
export async function lockApp(): Promise<void> {
  await baseTrpc.auth.lock.mutate().catch(() => undefined)
  useLockState.getState().lock()
}

/** Signs out every tab on every browser and device, then reloads so nothing from the session remains. */
export async function signOutEverywhere(): Promise<void> {
  await baseTrpc.auth.signOutEverywhere.mutate().catch(() => undefined)
  window.location.reload()
}
