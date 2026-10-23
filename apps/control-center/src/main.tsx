import '@fontsource/roboto-mono'
import { StrictMode } from 'react'
import * as ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import { SessionGate } from './pin/session-gate'
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
      <SessionGate>
        {/* Inside the gate, so a notice (an account name, say) never shows over the lock screen. */}
        <Toaster position="top-right" richColors />
        <Routes />
      </SessionGate>
    </Providers>
  </StrictMode>,
)
