import { ChakraProvider } from '@chakra-ui/react'
import { theme } from '@hoseki/packages/ui/design-system'
import '@hoseki/packages/ui/design-system/fonts/geist/index.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router'
import { Toaster } from 'sonner'
import { queryClient, reactTrpcClient, trpc } from './trpc'

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={reactTrpcClient} queryClient={queryClient}>
        <BrowserRouter>
          <ChakraProvider theme={theme}>
            <MotionConfig reducedMotion="user">
              <Toaster position="top-right" richColors />
              {children}
            </MotionConfig>
          </ChakraProvider>
        </BrowserRouter>
      </trpc.Provider>
    </QueryClientProvider>
  )
}
