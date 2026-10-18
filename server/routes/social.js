// Direct-message history, search and friends.
const { withPublicEmbeds } = require('../net/imageProxy');
const db = require('../db');
const { authUserId } = require('../auth/tokens');
const { sendJson, intParam, readJsonBody } = require('../http/util');
const { sendToUser } = require('../gateway/delivery');

const getJsonBody = readJsonBody;

// Tried in order; the first match handles the request.
const routes = [
  {
    // ---- Direct messages ----
    match: ({ pathSegments }) => pathSegments[0] === 'dms',
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });

      // GET /dms — conversation list with last message + unread
      if (pathSegments.length === 1 && req.method === 'GET') {
        const unread = {};
        for (const u of db.getDmUnreadCounts(userId)) unread[u.other] = u.count;
        const convos = db.getDmConversations(userId).map((c) => ({ ...c, unread: unread[c.username] || 0 }));
        return sendJson(res, 200, convos);
      }
      // DELETE /dms/:username/messages/:id/preview — the author removes a DM's
      // link cards (P3-20c); both people's copies drop them live.
      if (pathSegments[2] === 'messages' && pathSegments[4] === 'preview' && pathSegments.length === 5 && req.method === 'DELETE') {
        const other = db.getUserByUsername(pathSegments[1]);
        const dm = other ? db.getDmById(parseInt(pathSegments[3], 10) || 0) : null;
        const between = dm && [dm.user_a, dm.user_b].includes(userId) && [dm.user_a, dm.user_b].includes(other.id);
        if (!between) return sendJson(res, 404, { error: 'Message not found in this conversation' });
        if (dm.author_id !== userId) return sendJson(res, 403, { error: 'Only the author can remove a preview' });
        db.hideEmbeds('dm', dm.id);
        const frame = JSON.stringify({ type: 'dm_embeds', id: dm.id, embeds: [] });
        sendToUser(dm.user_a, frame);
        sendToUser(dm.user_b, frame);
        return sendJson(res, 200, { ok: true });
      }
      // GET /dms/:username/messages — latest history; ?before=<id> pages back, ?after=<id> backfills
      if (pathSegments[2] === 'messages' && req.method === 'GET') {
        const other = db.getUserByUsername(pathSegments[1]);
        if (!other) return sendJson(res, 404, { error: 'User not found' });
        const around = intParam(parsedUrl.query.around, 0, 0, Number.MAX_SAFE_INTEGER);
        if (around > 0) {
          const rows = db.getDmMessagesAround(userId, other.id, around);
          return rows ? sendJson(res, 200, withPublicEmbeds(rows)) : sendJson(res, 404, { error: 'Message not found in this conversation' });
        }
        const after = intParam(parsedUrl.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
        if (after > 0) {
          const afterLimit = intParam(parsedUrl.query.limit, 200, 1, 200);
          return sendJson(res, 200, withPublicEmbeds(db.getDmMessagesAfter(userId, other.id, after, afterLimit)));
        }
        const limit = intParam(parsedUrl.query.limit, 50, 1, 200);
        const before = intParam(parsedUrl.query.before, 0, 0, Number.MAX_SAFE_INTEGER);
        if (before > 0) return sendJson(res, 200, withPublicEmbeds(db.getDmMessagesBefore(userId, other.id, before, limit)));
        return sendJson(res, 200, withPublicEmbeds(db.getDmMessages(userId, other.id, limit, 0)));
      }
      return sendJson(res, 404, { error: 'Not found' });
    },
  },
  {
    // ---- Search ----
    match: ({ req, pathSegments }) => pathSegments[0] === 'search' && req.method === 'GET',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      const q = typeof parsedUrl.query.q === 'string' ? parsedUrl.query.q.trim().slice(0, 200) : '';
      if (q.length < 2) return sendJson(res, 200, { channels: [], dms: [] });
      return sendJson(res, 200, db.searchMessages(userId, q, 40));
    },
  },
  {
    match: ({ req, pathSegments }) => pathSegments[0] === 'friends' && pathSegments.length === 1 && req.method === 'GET',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      const friends = db.getFriends(userId).map(u => ({ username: u.username }));
      res.writeHead(200);
      return res.end(JSON.stringify({ friends }));
    },
  },
  {
    match: ({ req, pathSegments }) => pathSegments[0] === 'friends' && pathSegments[1] === 'requests' && req.method === 'GET',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      const reqs = db.getIncomingFriendRequests(userId).map(r => db.getUserById(r.from_user)?.username).filter(Boolean);
      res.writeHead(200);
      return res.end(JSON.stringify({ requests: reqs }));
    },
  },
  {
    match: ({ req, pathSegments }) => pathSegments[0] === 'friends' && pathSegments[1] === 'request' && req.method === 'POST',
    run: async ({ req, res, parsedUrl }) => {
      const fromId = authUserId(req, parsedUrl);
      if (!fromId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      const { username } = await getJsonBody(req);
      const to = db.getUserByUsername(username);
      if (!to) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
      if (to.id === fromId) return sendJson(res, 400, { error: "You can't send a friend request to yourself" });
      db.createFriendRequest(fromId, to.id);
      res.writeHead(201);
      return res.end(JSON.stringify({ message: 'Request sent' }));
    },
  },
  {
    match: ({ req, pathSegments }) => pathSegments[0] === 'friends' && pathSegments[1] === 'accept' && req.method === 'POST',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      const { username } = await getJsonBody(req);
      const fromUser = db.getUserByUsername(username);
      if (!fromUser) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
      // Only an actual pending request from that user can be accepted.
      if (!db.hasFriendRequest(fromUser.id, userId)) {
        return sendJson(res, 404, { error: 'No pending friend request from that user' });
      }
      db.removeFriendRequest(fromUser.id, userId);
      db.addFriends(userId, fromUser.id);
      res.writeHead(200);
      return res.end(JSON.stringify({ message: 'Friend added' }));
    },
  },
  {
    match: ({ req, pathSegments }) => pathSegments[0] === 'friends' && pathSegments[1] === 'reject' && req.method === 'POST',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      const { username } = await getJsonBody(req);
      const fromUser = db.getUserByUsername(username);
      if (fromUser) { db.removeFriendRequest(fromUser.id, userId); }
      res.writeHead(200);
      return res.end(JSON.stringify({ message: 'Request removed' }));
    },
  },
  {
    match: ({ req, pathSegments }) => pathSegments[0] === 'friends' && pathSegments[1] && req.method === 'DELETE',
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      const other = db.getUserByUsername(pathSegments[1]);
      if (!other) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
      db.removeFriend(userId, other.id);
      res.writeHead(200);
      return res.end(JSON.stringify({ message: 'Friend removed' }));
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
