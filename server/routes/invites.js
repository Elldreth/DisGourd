// Invite links: preview and join.
const db = require('../db');
const { authUserId } = require('../auth/tokens');
const { sendJson } = require('../http/util');
const { deliverToSpaceMembers } = require('../gateway/delivery');

// Tried in order; the first match handles the request.
const routes = [
  {
    // ---- Invites: preview and join ----
    match: ({ pathSegments }) => pathSegments[0] === 'invites' && pathSegments[1] && pathSegments.length === 2,
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      const invite = db.getInvite(pathSegments[1]);
      if (!invite) return sendJson(res, 404, { error: 'This invite is invalid or has expired' });
      const space = db.getSpaceById(invite.space_id);
      if (!space) return sendJson(res, 404, { error: 'That server no longer exists' });

      if (req.method === 'GET') {
        return sendJson(res, 200, {
          space: space.name,
          members: db.getSpaceMembers(space.id).length,
          alreadyMember: db.isMember(space.id, userId),
        });
      }
      if (req.method === 'POST') {
        // Expiry, remaining uses and membership are re-checked inside one
        // transaction, so concurrent joiners can't overrun max_uses.
        const result = db.redeemInvite(pathSegments[1], userId);
        if (result === 'invalid') return sendJson(res, 404, { error: 'This invite is invalid or has expired' });
        if (result === 'expired') return sendJson(res, 410, { error: 'This invite has expired' });
        if (result === 'exhausted') return sendJson(res, 410, { error: 'This invite has been fully used' });
        if (result === 'joined') {
          deliverToSpaceMembers(space.name, JSON.stringify({ type: 'members_changed', space: space.name }));
        }
        return sendJson(res, 200, { name: space.name });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    },
  },
];

// Returns true when one of these routes handled the request.
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
