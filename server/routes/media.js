// GET /media/preview/<sig>/<b64url> — link-preview images, fetched and cached
// by this server (net/imageProxy.js). Public like /uploads: the signature is
// what makes a path valid, so it needs no login (an <img> can't send one).
const imageProxy = require('../net/imageProxy');

const routes = [
  {
    match: ({ req, pathSegments }) => req.method === 'GET' && pathSegments[0] === 'media' && pathSegments[1] === 'preview',
    run: async ({ res, pathSegments }) => {
      if (pathSegments.length !== 4) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      return imageProxy.serve(res, pathSegments[2], pathSegments[3]);
    },
  },
];

async function handle(ctx) {
  for (const route of routes) {
    if (route.match(ctx)) {
      await route.run(ctx);
      return true;
    }
  }
  return false;
}

module.exports = { handle };
