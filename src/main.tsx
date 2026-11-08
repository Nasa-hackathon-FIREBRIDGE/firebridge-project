import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './astra.css'
import './geospatial.css'
import './platform.css'
import './components/ui/ui.css'
import './components/shell.polish.css'
import { MotionProvider } from './components/ui/MotionProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider><App /></MotionProvider>
  </StrictMode>,
)
