import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend to proxy API + WebSocket traffic to during development. Override
// with DISGOURD_SERVER when the server runs elsewhere.
const server = process.env.DISGOURD_SERVER || 'http://localhost:3000';
const wsServer = server.replace(/^http/, 'ws');

// Same-origin paths the frontend calls; each is proxied to the backend in dev
// so the client can use plain relative URLs and there are no CORS headaches.
const apiPaths = ['/register', '/login', '/uploads', '/spaces', '/friends', '/admin'];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      ...Object.fromEntries(apiPaths.map((p) => [p, { target: server, changeOrigin: true }])),
      '/gateway': { target: wsServer, ws: true },
    },
  },
});
