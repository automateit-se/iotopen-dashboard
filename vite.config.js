import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development /api and /mqtt are proxied to LYNX_URL (default: the local mock server),
// exactly like nginx does in the container. The browser never talks cross-origin.
const target = (process.env.LYNX_URL || 'http://localhost:8787').trim().replace(/\/$/, '');
console.log(`\n  /api + /mqtt proxy -> ${target}\n`);

export default defineConfig({
  // relative asset URLs: the same build works at / and under any path prefix (e.g. /dashboard/)
  base: './',
  plugins: [
    react(),
    {
      // like nginx: tell the app which server /api and /mqtt are proxied to (shown on the sign-in page)
      name: 'dev-config-json',
      configureServer(server) {
        server.middlewares.use('/config.json', (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ liveUpdates: 'true', lynxServer: target, customServers: 'true' }));
        });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      // same allow-list as nginx: only the API versions the dashboard uses
      '/api/v2': { target, changeOrigin: true, secure: true },
      '/api/v3beta/log': { target, changeOrigin: true, secure: true },
      '/mqtt': { target, changeOrigin: true, secure: true, ws: true },
    },
  },
});
