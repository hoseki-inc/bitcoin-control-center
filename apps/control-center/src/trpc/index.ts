import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { createTRPCProxyClient, httpLink } from '@trpc/react-query'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import superjson from 'superjson'
import { queryClient, trpc } from './base'
import { developmentFetch } from './development-latency'

export { queryClient, trpc }

export type RouterOutput = inferRouterOutputs<Router>
export type RouterInput = inferRouterInputs<Router>

export const transformer = registerCustomSerializers(superjson)

const url = import.meta.env.VITE_BACKEND_API_URL ?? ''

export const baseTrpc = createTRPCProxyClient<Router>({
  transformer,
  links: [
    httpLink({
      url,
    }),
  ],
})

export const reactTrpcClient = trpc.createClient({
  transformer,
  links: [
    // Note - Ben - 2025-05-30:
    // We used to use `httpBatchLink` here, but sometimes it randomly failed with 404.
    // I have a hunch that it's because of the URL length, but I'm not sure.
    // This is a workaround to use `httpLink` instead.
    // We can revert to using `httpBatchLink` when we figured out what's going on.
    httpLink({
      // maxURLLength: ???,
      url,
      fetch: developmentFetch(),
    }),
  ],
})
