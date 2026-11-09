import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts: production CSP only allows fonts from 'self'.
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import { MotionProvider } from './components/ui/MotionProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider><App /></MotionProvider>
  </StrictMode>,
)
