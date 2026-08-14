import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// В dev фронт живёт на :5173 и проксирует /api на Django.
// При сборке ассеты кладутся под /static/ — их отдаёт Django (whitenoise).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000', '/media': 'http://127.0.0.1:8000' },
  },
}))
