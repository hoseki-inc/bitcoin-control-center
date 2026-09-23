import { ChakraProvider, useColorMode } from '@chakra-ui/react'
import type { GlobalProvider } from '@ladle/react'
import { Buffer } from 'buffer'
import React, { useEffect } from 'react'
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

export const Provider: GlobalProvider = ({ children, globalState, storyMeta }) => (
  <ChakraProvider theme={theme}>
    <ColorModeFromLadle theme={globalState.theme} />
    <Toaster position="top-right" richColors theme={globalState.theme === 'dark' ? 'dark' : 'light'} />
    {children}
  </ChakraProvider>
)
