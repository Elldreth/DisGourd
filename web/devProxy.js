// The top-level API paths the dev server (vite.config.js) forwards to the
// backend, so the client can use plain relative URLs with no CORS. Every
// top-level path the client calls must be here, or in dev it gets the SPA's
// index.html instead of JSON; devProxy.test.js checks that against the client.
// Production doesn't use this: the Node server serves the API and the built
// app from one origin.
export const apiPaths = [
  '/register',
  '/login',
  '/auth-info',
  '/me',
  '/uploads',
  '/media',
  '/spaces',
  '/dms',
  '/friends',
  '/invites',
  '/search',
  '/admin',
  '/push',
];

// Proxy keys that match a path segment exactly (`/me` and `/me/…`, not
// `/media` or an app route like `/invite/<code>`). Vite treats a key that
// starts with ^ as a regular expression; a plain key would be a prefix match.
export function proxyKey(path) {
  return `^${path}(?=[/?]|$)`;
}
