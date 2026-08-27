import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import { QueryClient } from '@tanstack/react-query'
import { createTRPCReact } from '@trpc/react-query'

export const queryClient = new QueryClient()

export const trpc = createTRPCReact<Router>()
