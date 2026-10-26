import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { type DefaultOptions, MutationCache, QueryClient } from '@tanstack/react-query'
import { createTRPCReact } from '@trpc/react-query'
import { z } from 'zod'
import { isDesktop } from '../mode'

const HttpStatusSchema = z.object({ data: z.object({ httpStatus: z.number() }) })

/**
 * Retry a failed read twice, as a dropped Tor circuit or a busy device can fail a request that
 * works the next time, but not one Sentinel refused outright (a 4xx), which would fail again.
 */
export function shouldRetryQuery(failureCount: number, httpStatus: number | null): boolean {
  return failureCount < 2 && (httpStatus === null || httpStatus < 400 || httpStatus >= 500)
}

/** 1, 2, then 4 seconds; never the default 30, so a failure shows while it's still relevant. */
export function queryRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 8_000)
}

const defaultOptions: DefaultOptions = {
  queries: {
    // Moving between pages reuses data loaded in the last 15 seconds instead of asking again,
    // which over Tor costs seconds per request. Pages that poll or invalidate still refresh.
    staleTime: 15_000,
    retry: (failureCount, error) =>
      shouldRetryQuery(
        failureCount,
        parseUnknown(HttpStatusSchema, error)
          .map(({ data }) => data.httpStatus)
          .unwrapOr(null),
      ),
    retryDelay: queryRetryDelay,
  },
}
if (isDesktop) {
  // Electron talks to a local Sentinel server even when the computer has no
  // internet connection. Keep local data and recovery settings accessible.
  defaultOptions.queries = { ...defaultOptions.queries, networkMode: 'always' }
  defaultOptions.mutations = { networkMode: 'always' }
}

export const queryClient: QueryClient = new QueryClient({
  defaultOptions,
  mutationCache: new MutationCache({
    // Data is reused for 15 seconds, so any change marks all of it stale: whatever page shows next
    // fetches again, as every page did before. Data on screen refreshes where the change asks for it.
    onSuccess: () => {
      void queryClient.invalidateQueries({ refetchType: 'none' })
    },
  }),
})

export const trpc = createTRPCReact<Router>()
