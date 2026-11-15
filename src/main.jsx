import { Sentry } from './monitoring/index.js'
import ErrorFallback from './monitoring/ErrorFallback.jsx'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root'), {
  onUncaughtError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={props => <ErrorFallback {...props} />}><App /></Sentry.ErrorBoundary>
  </StrictMode>,
)
