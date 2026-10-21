// Voice (P11-11): GET /voice/ice, the ICE servers (and short-lived TURN
// credentials, if a relay is set up) for the signed-in person's calls.
const { authUserId } = require('../auth/tokens');
const { sendJson } = require('../http/util');
const { rateLimitOk } = require('../auth/rateLimit');
const ice = require('../voice/ice');

ice.checkConfig();

const routes = [
  {
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/voice/ice' && req.method === 'GET',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      // Joining calls all evening is fine; a loop asking Cloudflare isn't.
      if (!rateLimitOk(`voice-ice:${userId}`, 60, 10 * 60 * 1000)) return sendJson(res, 429, { error: 'Too many requests. Please wait a minute.' });
      res.setHeader('Cache-Control', 'no-store'); // credentials
      return sendJson(res, 200, await ice.iceFor(userId));
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
