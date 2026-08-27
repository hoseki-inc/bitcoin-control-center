import '@fontsource/roboto-mono'
import { StrictMode } from 'react'
import * as ReactDOM from 'react-dom/client'
import { Providers } from './providers'
import Routes from './routes'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

root.render(
  <StrictMode>
    <Providers>
      <Routes />
    </Providers>
  </StrictMode>,
)
