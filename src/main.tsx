import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function boot() {
  if (import.meta.env.MODE !== 'electron') {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
