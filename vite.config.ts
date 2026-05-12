import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// `vite build` → GitHub Pages (/cgf-recetas/)
// `vite build --mode electron` → instalador Electron (rutas relativas + sin PWA)
export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron'

  return {
    base: isElectron ? './' : '/cgf-recetas/',
    plugins: [
      react(),
      ...(isElectron
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              devOptions: {
                enabled: true,
              },
              manifest: {
                name: 'Costos fórmula 1.37.0',
                short_name: 'Costos 1.37.0',
                description: 'Calcula costos y precio final según materia prima y ganancia.',
                start_url: '/',
                display: 'standalone',
                background_color: '#ffffff',
                theme_color: '#0b5ed7',
                icons: [
                  { src: 'logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
                ],
              },
            }),
          ]),
    ],
  }
})
