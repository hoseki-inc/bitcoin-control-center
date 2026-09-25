import { ChakraProvider, type ChakraProviderProps } from '@chakra-ui/react'
import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import { useState } from 'react'

export function TestChakraProvider(props: ChakraProviderProps): JSX.Element {
  // Each test owns a new document; Emotion's default cache still targets the import-time document.
  const [cache] = useState(() => createCache({ key: 'css', container: document.head }))
  return (
    <CacheProvider value={cache}>
      <ChakraProvider {...props} />
    </CacheProvider>
  )
}
