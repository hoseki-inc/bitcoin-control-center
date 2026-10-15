import { trpc } from '../../trpc'

export const ELECTRUM_UNREACHABLE_BALANCE_MESSAGE = "Balance unavailable: your Electrum server isn't reachable yet."

/**
 * The message for a failed balance lookup. A server that can't be reached, such as Electrs while it is
 * still indexing, gets a plain explanation instead of the socket error. A server that answered with an
 * error keeps its own message.
 */
export function balanceErrorMessage(
  error: { message: string } | null,
  electrumReachable: boolean | undefined,
): string | null {
  if (error === null) {
    return null
  }
  return electrumReachable === true ? error.message : ELECTRUM_UNREACHABLE_BALANCE_MESSAGE
}

/** `balanceErrorMessage`, asking Sentinel whether Electrum is reachable once a lookup has failed. */
export function useBalanceErrorMessage(error: { message: string } | null): string | null {
  const status = trpc.settings.electrumStatus.useQuery(undefined, {
    enabled: error !== null,
    refetchOnWindowFocus: false,
  })
  return balanceErrorMessage(error, status.data?.connected)
}
