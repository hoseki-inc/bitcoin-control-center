import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import { QueryClient } from '@tanstack/react-query'
import { createTRPCReact } from '@trpc/react-query'
import { isDesktop } from '../mode'

export const queryClient = new QueryClient({
  // Electron talks to a local Sentinel server even when the computer has no
  // internet connection. Keep local data and recovery settings accessible.
  defaultOptions: isDesktop ? { queries: { networkMode: 'always' }, mutations: { networkMode: 'always' } } : undefined,
})

export const trpc = createTRPCReact<Router>()
