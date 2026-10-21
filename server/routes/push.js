// Web Push subscriptions (P2-18b): the public key, and saving or removing
// this browser's subscription. All signed-in only.
const db = require('../db');
const { authUserId } = require('../auth/tokens');
const { sendJson, readJsonBody } = require('../http/util');
const push = require('../push');
const { allowedPushEndpoint } = require('../net/pushHosts');

const validSubscription = (s) =>
  s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 2048
  && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';

const routes = [
  {
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/push/vapid-key' && req.method === 'GET',
    run: async ({ req, res, parsedUrl }) => {
      if (!authUserId(req, parsedUrl)) return sendJson(res, 401, { error: 'Unauthorized' });
      return sendJson(res, 200, { key: push.publicKey() });
    },
  },
  {
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/push/subscriptions' && (req.method === 'POST' || req.method === 'DELETE'),
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      const body = await readJsonBody(req);
      if (req.method === 'DELETE') {
        const ok = typeof body.endpoint === 'string' && db.deletePushSubscription(userId, body.endpoint);
        return sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'No such subscription' });
      }
      if (!validSubscription(body.subscription)) return sendJson(res, 400, { error: 'That is not a push subscription' });
      // P11-10: only the real push services, never an address on our own network.
      if (!allowedPushEndpoint(body.subscription.endpoint)) return sendJson(res, 400, { error: "That push service isn't supported" });
      db.savePushSubscription(userId, body.subscription, body.previews !== false);
      return sendJson(res, 201, { ok: true, previews: body.previews !== false });
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
