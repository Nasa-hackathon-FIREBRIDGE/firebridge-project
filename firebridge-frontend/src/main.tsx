import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts: production CSP only allows fonts from 'self'.
// Inter with its optical-size axis: the text cut at reading sizes, the display cut for headlines.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/inter/opsz-italic.css'
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
