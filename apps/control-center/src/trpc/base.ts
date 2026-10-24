import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient } from '@tanstack/react-query'
import { createTRPCReact } from '@trpc/react-query'
import { z } from 'zod'
import { isDesktop } from '../mode'

const NeedsPinError = z.object({ data: z.object({ httpStatus: z.literal(401) }) })

/** Sentinel wants the PIN; retrying won't help, and the lock screen takes over. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- React Query hands over any thrown value; it is parsed here.
export function needsPin(error: unknown): boolean {
  return parseUnknown(NeedsPinError, error).isOk()
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- React Query's retry callback receives any thrown value.
const retry = (failureCount: number, error: unknown): boolean => !needsPin(error) && failureCount < 3

export const queryClient = new QueryClient({
  // Electron talks to a local Sentinel server even when the computer has no
  // internet connection. Keep local data and recovery settings accessible.
  defaultOptions: isDesktop
    ? { queries: { networkMode: 'always', retry }, mutations: { networkMode: 'always' } }
    : { queries: { retry } },
})

export const trpc = createTRPCReact<Router>()
