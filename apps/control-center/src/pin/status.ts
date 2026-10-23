import { Err, Ok, Result } from '@hoseki/packages/result'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { type RouterOutput, baseTrpc, queryClient } from '../trpc'
import { retireTabId, useLockState } from './session'

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

// Long enough for a slow connection; the tab gets a new ID afterwards either way.
const LOCK_REQUEST_LIMIT_MS = 5000

/**
 * Locks this tab. The lock screen covers the app at once; Sentinel ends the session, and the tab then gets a new
 * ID so a reload asks for the PIN even if that request never arrived.
 */
export async function lockApp(): Promise<void> {
  useLockState.getState().lock()
  // Sent with the current tab ID, which the request reads as it starts.
  const request = baseTrpc.auth.lock.mutate().catch(() => undefined)
  await Promise.race([
    request,
    new Promise((resolve) => {
      setTimeout(resolve, LOCK_REQUEST_LIMIT_MS)
    }),
  ])
  retireTabId()
}

/**
 * Signs out every tab on every browser and device, then reloads so nothing from the session remains. An error if
 * Sentinel didn't confirm it, so the other devices may still be signed in.
 */
export async function signOutEverywhere(): Promise<Result<void, Error>> {
  const result = await Result.fromPromise(baseTrpc.auth.signOutEverywhere.mutate())
  if (result.isErr()) {
    return Err(result.unwrapErr())
  }
  window.location.reload()
  return Ok(undefined)
}
