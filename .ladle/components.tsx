import { ChakraProvider } from '@chakra-ui/react'
import { theme } from '@hoseki/packages/ui/design-system'
import '@hoseki/packages/ui/design-system/fonts/geist/index.css'
import type { GlobalProvider } from '@ladle/react'
import { Buffer } from 'buffer'
import React from 'react'
import { Toaster } from 'sonner'

// Removes a TS error with <ChakraProvider> below
const _unused = React

// Various hacks to make Ladle work. Also see comments in vite.config.ts
// Node typings include these globals, but the browser may not have them yet.
const browserGlobals: { global?: typeof globalThis; Buffer?: typeof Buffer } = window
browserGlobals.global ??= window
browserGlobals.Buffer ??= Buffer

export const Provider: GlobalProvider = ({ children }) => (
  <ChakraProvider theme={theme}>
    <Toaster position="top-right" richColors />
    {children}
  </ChakraProvider>
)
