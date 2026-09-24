import { ChakraProvider, type ChakraProviderProps, useColorMode } from '@chakra-ui/react'
import { theme } from '@hoseki/packages/ui/design-system'
import '@hoseki/packages/ui/design-system/fonts/geist/index.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router'
import { Toaster } from 'sonner'
import './fonts/inter/bitcoin.css'
import { AppearanceSync, resolveAppearance } from './hooks/use-appearance'
import { StatementPollingProvider } from './providers/statement-polling-provider'
import { queryClient, reactTrpcClient, trpc } from './trpc'

// The appearance preference (system/light/dark) lives in its own store; Chakra only
// receives the resolved mode, so its own persistence is intentionally a no-op.
const appearanceManager: NonNullable<ChakraProviderProps['colorModeManager']> = {
  type: 'localStorage',
  ssr: false,
  get: () => resolveAppearance(),
  set: () => undefined,
}

// Toasts use the glass toast material; sonner's own icons carry the status colour.
const toastStyle = {
  background: 'var(--toast-tint)',
  backdropFilter: 'var(--toast-filter)',
  WebkitBackdropFilter: 'var(--toast-filter)',
  border: '0.5px solid var(--material-edge)',
  borderRadius: 'var(--radius-toast)',
  boxShadow: 'inset 0 1px rgb(255 255 255 / var(--material-shine)), var(--toast-shadow)',
  color: 'var(--hoseki-colors-text-primary)',
  fontFamily: 'inherit',
} as const

function ThemedToaster(): JSX.Element {
  const { colorMode } = useColorMode()
  return <Toaster position="top-right" theme={colorMode} offset={20} toastOptions={{ style: toastStyle }} />
}

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={reactTrpcClient} queryClient={queryClient}>
        <BrowserRouter>
          <ChakraProvider theme={theme} colorModeManager={appearanceManager}>
            <AppearanceSync />
            <MotionConfig reducedMotion="user">
              <ThemedToaster />
              <StatementPollingProvider>{children}</StatementPollingProvider>
            </MotionConfig>
          </ChakraProvider>
        </BrowserRouter>
      </trpc.Provider>
    </QueryClientProvider>
  )
}
