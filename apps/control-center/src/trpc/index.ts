import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { createTRPCProxyClient, httpLink } from '@trpc/react-query'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import superjson from 'superjson'
import { z } from 'zod'
import { TAB_HEADER, sentinelFetch } from '../pin/session'
import { queryClient, trpc } from './base'

export { queryClient, trpc }

export type RouterOutput = inferRouterOutputs<Router>
export type RouterInput = inferRouterInputs<Router>

export const transformer = registerCustomSerializers(superjson)

const url = import.meta.env.VITE_BACKEND_API_URL ?? ''

const TabContext = z.object({ tabId: z.string() })

export const baseTrpc = createTRPCProxyClient<Router>({
  transformer,
  links: [
    httpLink({
      url,
      fetch: sentinelFetch,
      // A call can name the tab it acts for: the lock sends the ID this tab just retired.
      headers: ({ op }): Record<string, string> => {
        const context = parseUnknown(TabContext, op.context)
        return context.isOk() ? { [TAB_HEADER]: context.unwrap().tabId } : {}
      },
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
      fetch: sentinelFetch,
    }),
  ],
})
