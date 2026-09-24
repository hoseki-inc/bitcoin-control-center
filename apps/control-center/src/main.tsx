import '@fontsource/roboto-mono'
import { StrictMode } from 'react'
import * as ReactDOM from 'react-dom/client'
import { Providers } from './providers'
import Routes from './routes'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Missing application root element')
}
const root = ReactDOM.createRoot(rootElement)

root.render(
  <StrictMode>
    <Providers>
      <Routes />
    </Providers>
  </StrictMode>,
)
