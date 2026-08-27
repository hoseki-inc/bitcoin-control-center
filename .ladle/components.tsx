import { ChakraProvider } from '@chakra-ui/react'
import type { GlobalProvider } from '@ladle/react'
import { Buffer } from 'buffer'
import React from 'react'
import { Toaster } from 'sonner'
import { theme } from '../packages/ui/design-system'
import '../packages/ui/design-system/fonts/geist/index.css'

// Removes a TS error with <ChakraProvider> below
const _unused = React

// Various hacks to make Ladle work. Also see comments in vite.config.ts
window.global ||= window
if (!window.Buffer) {
  window.Buffer = Buffer
}

export const Provider: GlobalProvider = ({ children, globalState, storyMeta }) => (
  <ChakraProvider theme={theme}>
    <Toaster position="top-right" richColors />
    {children}
  </ChakraProvider>
)
