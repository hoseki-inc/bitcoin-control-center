import { ChakraProvider, useColorMode } from '@chakra-ui/react'
import { theme } from '@hoseki/packages/ui/design-system'
import '@hoseki/packages/ui/design-system/fonts/geist/index.css'
import { type GlobalProvider, ThemeState } from '@ladle/react'
import { Buffer } from 'buffer'
import React, { useEffect } from 'react'
import { Toaster } from 'sonner'

// Removes a TS error with <ChakraProvider> below
const _unused = React

// Various hacks to make Ladle work. Also see comments in vite.config.ts
// Node typings include these globals, but the browser may not have them yet.
const browserGlobals: { global?: typeof globalThis; Buffer?: typeof Buffer } = window
browserGlobals.global ??= window
browserGlobals.Buffer ??= Buffer

// Follows Ladle's theme switcher so every story can be checked in light and dark glass.
function ColorModeFromLadle({ theme: ladleTheme }: { theme: string }): null {
  const { setColorMode } = useColorMode()
  useEffect(() => {
    const dark =
      ladleTheme === 'dark' || (ladleTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    setColorMode(dark ? 'dark' : 'light')
  }, [ladleTheme, setColorMode])
  return null
}

export const Provider: GlobalProvider = ({ children, globalState }) => (
  <ChakraProvider theme={theme}>
    <ColorModeFromLadle theme={globalState.theme} />
    <Toaster position="top-right" richColors theme={globalState.theme === ThemeState.Dark ? 'dark' : 'light'} />
    {children}
  </ChakraProvider>
)
