import { Err, Ok, Result } from '@hoseki/packages/result'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { clearFlowSource } from '../lib/flow-tracker'
import { type RouterOutput, baseTrpc, queryClient } from '../trpc'
import { type PinStatus, currentEpoch, dispatch, endsSession, useGate } from './gate'
import { retireTabId, tabId } from './tab'

export type PinOutcome = RouterOutput['auth']['signIn']

const PIN_STATUS_KEY = ['pin-status']

function toPinStatus(answer: RouterOutput['auth']['status']): PinStatus {
  if (answer.platform === null) {
    return answer
  }
  const { retryAfterMs, ...rest } = answer
  return { ...rest, retryAt: retryAfterMs === null ? null : Date.now() + retryAfterMs }
}

/** Whether this tab needs a PIN, and its state. Each answer moves the gate, unless a lock overtook it. */
export function usePinStatus(): UseQueryResult<PinStatus> {
  return useQuery({
    queryKey: PIN_STATUS_KEY,
    queryFn: async () => {
      const asked = useGate.getState()
      const status = toPinStatus(await baseTrpc.auth.status.query())
      if (endsSession(useGate.getState(), asked, status)) {
        void lockApp()
      } else {
        dispatch({ type: 'answered', status, asked })
      }
      return status
    },
    // A failed first check shows its own screen, so give a brief network hiccup a couple of tries first.
    retry: 2,
    // Never reuse an answer: coming back to the tab always checks, so a sign-out elsewhere locks it.
    staleTime: 0,
    refetchOnWindowFocus: true,
    // While StartOS has yet to set the PIN, notice when it does.
    refetchInterval: (data) => (data?.platform === 'startos' && data.state === 'no-pin' ? 5000 : false),
  })
}

function updateStatus(update: (status: Exclude<PinStatus, { platform: null }>) => PinStatus): void {
  queryClient.setQueryData<PinStatus>(PIN_STATUS_KEY, (status) =>
    status && status.platform !== null ? update(status) : status,
  )
}

/** Records a wrong-PIN delay Sentinel reported, so every PIN field counts it down. */
export function setRetryAt(retryAfterMs: number): void {
  updateStatus((status) => ({ ...status, retryAt: Date.now() + retryAfterMs }))
}

export async function refreshPinStatus(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: PIN_STATUS_KEY })
}

/** The app has left the screen: drop everything it loaded, so nothing stays in memory behind the lock screen. */
export async function forgetApp(): Promise<void> {
  clearFlowSource()
  const others = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== PIN_STATUS_KEY[0] }
  await queryClient.cancelQueries(others)
  queryClient.removeQueries(others)
  queryClient.getMutationCache().clear()
  await refreshPinStatus()
}

async function endSession(tab: string): Promise<void> {
  await baseTrpc.auth.lock.mutate(undefined, { context: { tabId: tab } }).catch(() => undefined)
}

/**
 * Locks this tab. It gets a new ID and the lock screen covers the app at once, so neither a reload nor a sign-in can
 * resume the old session; Sentinel is then told to end that session, by its old ID.
 */
export async function lockApp(at: 'fade' | 'once' = 'fade'): Promise<void> {
  const retired = retireTabId()
  dispatch({ type: 'lock', at })
  await endSession(retired)
}

/** Sentinel opened a session for a sign-in that a lock overtook; end it, since this tab no longer uses its ID. */
async function signingIn(start: (tab: string) => Promise<PinOutcome>): Promise<PinOutcome> {
  const epoch = currentEpoch()
  const tab = tabId()
  const outcome = await start(tab)
  if (outcome.ok && currentEpoch() !== epoch) {
    void endSession(tab)
  }
  return outcome
}

export async function signIn(pin: string): Promise<PinOutcome> {
  return signingIn(async (tab) => baseTrpc.auth.signIn.mutate({ pin }, { context: { tabId: tab } }))
}

/** Sets the first PIN, which signs this tab in; setup then stays on screen through its Save step. */
export async function setFirstPin(pin: string): Promise<PinOutcome> {
  const epoch = currentEpoch()
  const outcome = await signingIn(async (tab) => baseTrpc.auth.setFirstPin.mutate({ pin }, { context: { tabId: tab } }))
  // An answer to an older check would say there's no PIN yet.
  await queryClient.cancelQueries({ queryKey: PIN_STATUS_KEY })
  updateStatus((status) => ({ ...status, state: currentEpoch() === epoch ? 'signed-in' : 'signed-out' }))
  dispatch({ type: 'pin-set', epoch })
  return outcome
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
