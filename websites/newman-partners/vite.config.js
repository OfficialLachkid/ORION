import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/ruflo/sites/newman-partners/',
  plugins: [react()],
  server: { port: 5173, open: false },
})
