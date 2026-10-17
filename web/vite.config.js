import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The backend to proxy API + WebSocket traffic to during development. Override
// with DISGOURD_SERVER when the server runs elsewhere.
const server = process.env.DISGOURD_SERVER || 'http://localhost:3000';
const wsServer = server.replace(/^http/, 'ws');

// Same-origin paths the frontend calls; each is proxied to the backend in dev
// so the client can use plain relative URLs and there are no CORS headaches.
const apiPaths = ['/register', '/login', '/auth-info', '/uploads', '/media', '/spaces', '/friends', '/admin'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The emoji data (emojibase, ~570 kB of JSON) is its own chunk, loaded only
    // when the picker opens, so it's fine for it to be big.
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: {
      ...Object.fromEntries(apiPaths.map((p) => [p, { target: server, changeOrigin: true }])),
      '/gateway': { target: wsServer, ws: true },
    },
  },
  // Unit + smoke tests (`npm test`). Test files live next to the code as
  // *.test.js(x); Vite never bundles them because nothing imports them.
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
