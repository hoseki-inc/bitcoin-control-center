import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type Operation, TRPCClientError } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { ReactNode } from 'react'
import { transformer, trpc } from '../trpc'

type TestTrpcClient = ReturnType<typeof trpc.createClient>

/** Run the real tRPC hooks against a local service implementation. */
export function createTestTrpcClient(handle: (operation: Operation) => Promise<unknown>): TestTrpcClient {
  return trpc.createClient({
    transformer,
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            let cancelled = false
            void Promise.resolve()
              .then(async () => handle(op))
              .then(
                (data) => {
                  if (!cancelled) {
                    observer.next({ result: { data } })
                    observer.complete()
                  }
                },
                (cause: unknown) => {
                  if (!cancelled) {
                    observer.error(
                      TRPCClientError.from(
                        cause instanceof Error ? cause : new Error('Test service failed', { cause }),
                      ),
                    )
                  }
                },
              )
            return () => {
              cancelled = true
            }
          }),
    ],
  })
}

export function TestTrpcProvider({
  client,
  rpc,
  children,
}: {
  client: QueryClient
  rpc: TestTrpcClient
  children?: ReactNode
}): JSX.Element {
  return (
    <trpc.Provider client={rpc} queryClient={client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
