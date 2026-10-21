// Invite links: preview and join.
const db = require('../db');
const { authUserId } = require('../auth/tokens');
const { sendJson } = require('../http/util');
const { deliverToSpaceMembers } = require('../gateway/delivery');
const { rateLimitOk, limitKey } = require('../auth/rateLimit');
const { inviteCanCreateAccount } = require('../auth/invitePolicy');

const INVALID = 'This invite is invalid or has expired';

// Tried in order; the first match handles the request.
const routes = [
  {
    // GET /invites/:code/preview (P14-01): public, so a signed-out person who
    // opens an invite link sees what it's for. Only the server's name and
    // icon, the inviter's name and a member count, and only for an invite that
    // still works; anything else gets the same 404.
    match: ({ req, pathSegments }) => pathSegments[0] === 'invites' && pathSegments[1] && pathSegments[2] === 'preview' && pathSegments.length === 3 && req.method === 'GET',
    run: async ({ req, res, pathSegments }) => {
      if (!rateLimitOk('invite-preview:' + limitKey(req), 30, 15 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
      }
      const invite = db.getInvite(pathSegments[1]);
      const usable = invite && !(invite.expires_at && Date.now() > invite.expires_at) && !(invite.max_uses && invite.uses >= invite.max_uses);
      const space = usable ? db.getSpaceCard(invite.space_id) : null;
      if (!space) return sendJson(res, 404, { error: INVALID });
      const inviter = invite.created_by ? db.getUserById(invite.created_by) : null;
      return sendJson(res, 200, {
        space: space.name,
        icon: space.icon || null,
        inviter: inviter ? inviter.username : null,
        members: db.getSpaceMembers(space.id).length,
        signUp: inviteCanCreateAccount(invite),
      });
    },
  },
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
          banned: db.isBanned(space.id, userId),
        });
      }
      if (req.method === 'POST') {
        // Expiry, remaining uses and membership are re-checked inside one
        // transaction, so concurrent joiners can't overrun max_uses.
        const result = db.redeemInvite(pathSegments[1], userId);
        if (result === 'invalid') return sendJson(res, 404, { error: 'This invite is invalid or has expired' });
        if (result === 'banned') return sendJson(res, 403, { error: "You're banned from this server" });
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
