import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/ruflo/sites/newman-partners-v2/',
  plugins: [react()],
  server: { port: 5174, open: false },
})
