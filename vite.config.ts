import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The UI lives under src/web; the API and the SSE stream are proxied to the Hono server in dev.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // Anchored regexes: a plain '/api' prefix would also catch the page's own /api.ts module,
      // because the web root is src/web and its files are served at the top level.
      '^/api/': 'http://127.0.0.1:3000',
      '^/events/': 'http://127.0.0.1:3000',
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
})
