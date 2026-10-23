import { Err, Ok, Result } from '@hoseki/packages/result'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { type RouterOutput, baseTrpc, queryClient } from '../trpc'
import { retireTabId, tabId, useLockState } from './session'

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

/**
 * Locks this tab. It gets a new ID and the lock screen covers the app at once, so neither a reload nor a sign-in
 * can resume the old session; Sentinel is then told to end that session, by its old ID.
 */
export async function lockApp(): Promise<void> {
  const retired = tabId()
  retireTabId()
  useLockState.getState().lock()
  await baseTrpc.auth.lock.mutate(undefined, { context: { tabId: retired } }).catch(() => undefined)
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
