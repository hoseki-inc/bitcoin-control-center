import { Err, Ok, Result } from '@hoseki/packages/result'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { type RouterOutput, baseTrpc, queryClient } from '../trpc'
import { currentEpoch, isCurrent, lock, retireTabId, tabId, useGate } from './session'

export type PinStatus = RouterOutput['auth']['status']
export type PinPlatform = NonNullable<PinStatus['platform']>
export type PinOutcome = RouterOutput['auth']['signIn']

export const PIN_STATUS_KEY = ['pin-status']

export function usePinStatus(): UseQueryResult<PinStatus> {
  return useQuery({
    queryKey: PIN_STATUS_KEY,
    queryFn: async () => baseTrpc.auth.status.query(),
    // A failed first check shows its own screen, so give a brief network hiccup a couple of tries first.
    retry: 2,
    refetchOnWindowFocus: true,
    // While StartOS has yet to set the PIN, notice when it does.
    refetchInterval: (data) => (data?.platform === 'startos' && !data.pinSet ? 5000 : false),
  })
}

export async function refreshPinStatus(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: PIN_STATUS_KEY })
}

/** Records what Sentinel just confirmed, rather than wait to ask again. */
export function setPinStatus(patch: Partial<PinStatus>): void {
  queryClient.setQueryData<PinStatus>(PIN_STATUS_KEY, (current) => (current ? { ...current, ...patch } : current))
}

/** Drops everything the app has loaded, so nothing stays in memory behind the lock screen. */
export async function forgetLoadedData(): Promise<void> {
  const keep = (queryKey: readonly unknown[]): boolean => queryKey[0] === PIN_STATUS_KEY[0]
  await queryClient.cancelQueries({ predicate: (query) => !keep(query.queryKey) })
  queryClient.removeQueries({ predicate: (query) => !keep(query.queryKey) })
  queryClient.getMutationCache().clear()
}

/** Ends a tab's session on Sentinel, by the tab's ID. */
async function endSession(tab: string): Promise<void> {
  await baseTrpc.auth.lock.mutate(undefined, { context: { tabId: tab } }).catch(() => undefined)
}

/**
 * Locks this tab. It gets a new ID and the lock screen covers the app at once, so neither a reload nor a sign-in
 * can resume the old session; Sentinel is then told to end that session, by its old ID. With `immediate`, the app
 * closes in the same render, with no fade.
 */
export async function lockApp(immediate = false): Promise<void> {
  const retired = tabId()
  retireTabId()
  lock(immediate)
  await endSession(retired)
}

/** A session Sentinel opens after a lock has already voided the sign-in is ended straight away. */
async function signingIn<T extends PinOutcome>(
  submit: (tab: string) => Promise<T>,
): Promise<{ outcome: T; epoch: number | null }> {
  const epoch = currentEpoch()
  const tab = tabId()
  const outcome = await submit(tab)
  if (!outcome.ok) {
    return { outcome, epoch: null }
  }
  if (!isCurrent(epoch)) {
    await endSession(tab)
    return { outcome, epoch: null }
  }
  return { outcome, epoch }
}

export async function signIn(pin: string): Promise<PinOutcome> {
  return (await signingIn(async (tab) => baseTrpc.auth.signIn.mutate({ pin }, { context: { tabId: tab } }))).outcome
}

/**
 * Sets the first PIN and signs this tab in. Returns the epoch setup carries on in, or null if the app locked
 * meanwhile, so the Save step, which shows the PIN, never appears after a lock.
 */
export async function setFirstPin(pin: string): Promise<number | null> {
  const { epoch } = await signingIn(async (tab) =>
    baseTrpc.auth.setFirstPin.mutate({ pin }, { context: { tabId: tab } }),
  )
  setPinStatus({ pinSet: true })
  if (epoch !== null) {
    useGate.setState({ setupEpoch: epoch })
  }
  return epoch
}

export async function confirmPin(pin: string): Promise<PinOutcome> {
  return baseTrpc.auth.confirmPin.mutate({ pin })
}

export async function changePin(currentPin: string, newPin: string): Promise<PinOutcome> {
  return baseTrpc.auth.changePin.mutate({ currentPin, newPin })
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
