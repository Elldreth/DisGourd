// Direct-message history, search and friends.
const { withPublicEmbeds } = require('../net/imageProxy');
const db = require('../db');
const { authUserId } = require('../auth/tokens');
const { sendJson, intParam, readJsonBody } = require('../http/util');
const { sendToUser } = require('../gateway/delivery');
const { rateLimitOk } = require('../auth/rateLimit');

const getJsonBody = readJsonBody;

// Tried in order; the first match handles the request.
const routes = [
  {
    // ---- Direct messages ----
    match: ({ pathSegments }) => pathSegments[0] === 'dms',
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });

      // GET /dms — my conversations with their last message and unread (P9-06a:
      // id, kind, members; pairs also the other person's username and avatar)
      if (pathSegments.length === 1 && req.method === 'GET') {
        return sendJson(res, 200, db.getDmConversations(userId));
      }
      // The conversation a path means (P9-06a): /dms/c/:id/… (if I'm in it),
      // or /dms/:username/… (our pair; null `id` if we've never talked).
      // `rest` is the path after it.
      let conv;
      if (pathSegments[1] === 'c' && /^\d+$/.test(pathSegments[2] || '')) {
        const id = parseInt(pathSegments[2], 10);
        if (!db.isParticipant(id, userId)) return sendJson(res, 404, { error: 'Conversation not found' });
        conv = { id, rest: pathSegments.slice(3) };
      } else {
        const other = db.getUserByUsername(pathSegments[1] || '');
        if (!other) return sendJson(res, 404, { error: 'User not found' });
        conv = { id: other.id === userId ? null : db.findPair(userId, other.id), rest: pathSegments.slice(2) };
      }
      const { rest } = conv;
      // A message of this conversation, or null.
      const messageHere = (mid) => {
        const dm = conv.id ? db.getDmById(parseInt(mid, 10) || 0) : null;
        return dm && dm.conversationId === conv.id ? dm : null;
      };
      // GET …/messages/:id/versions — a DM's edit history (P3-27), for anyone in the conversation.
      if (rest[0] === 'messages' && rest[2] === 'versions' && rest.length === 3 && req.method === 'GET') {
        const dm = messageHere(rest[1]);
        if (!dm) return sendJson(res, 404, { error: 'Message not found in this conversation' });
        return sendJson(res, 200, db.getDmVersions(dm.id));
      }
      // DELETE …/messages/:id/preview — the author removes a DM's link cards
      // (P3-20c); everyone's copies drop them live.
      if (rest[0] === 'messages' && rest[2] === 'preview' && rest.length === 3 && req.method === 'DELETE') {
        const dm = messageHere(rest[1]);
        if (!dm) return sendJson(res, 404, { error: 'Message not found in this conversation' });
        if (dm.author_id !== userId) return sendJson(res, 403, { error: 'Only the author can remove a preview' });
        db.hideEmbeds('dm', dm.id);
        const frame = JSON.stringify({ type: 'dm_embeds', id: dm.id, conversation: dm.conversationId, embeds: [] });
        for (const id of db.participantIds(dm.conversationId)) sendToUser(id, frame);
        return sendJson(res, 200, { ok: true });
      }
      // GET …/messages — latest history; ?before=<id> pages back, ?after=<id> backfills, ?around=<id> jumps
      if (rest[0] === 'messages' && rest.length === 1 && req.method === 'GET') {
        const around = intParam(parsedUrl.query.around, 0, 0, Number.MAX_SAFE_INTEGER);
        if (around > 0) {
          const rows = conv.id ? db.getConversationMessagesAround(conv.id, around) : null;
          return rows ? sendJson(res, 200, withPublicEmbeds(rows)) : sendJson(res, 404, { error: 'Message not found in this conversation' });
        }
        if (!conv.id) return sendJson(res, 200, []); // never talked yet
        const after = intParam(parsedUrl.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
        if (after > 0) {
          const afterLimit = intParam(parsedUrl.query.limit, 200, 1, 200);
          return sendJson(res, 200, withPublicEmbeds(db.getConversationMessagesAfter(conv.id, after, afterLimit)));
        }
        const limit = intParam(parsedUrl.query.limit, 50, 1, 200);
        const before = intParam(parsedUrl.query.before, 0, 0, Number.MAX_SAFE_INTEGER);
        if (before > 0) return sendJson(res, 200, withPublicEmbeds(db.getConversationMessagesBefore(conv.id, before, limit)));
        return sendJson(res, 200, withPublicEmbeds(db.getConversationMessages(conv.id, limit, 0)));
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
      // P11-03: a search scans every message you can see, so it's limited per person.
      if (!rateLimitOk(`search:${userId}`, 10, 60 * 1000)) return sendJson(res, 429, { error: 'Too many searches. Please wait a minute.' });
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
    // ---- Blocking (P9-07a) ----
    // GET /blocks — the people I've blocked. PUT / DELETE /blocks/:username.
    match: ({ pathSegments }) => pathSegments[0] === 'blocks' && pathSegments.length <= 2,
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (pathSegments.length === 1) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        return sendJson(res, 200, db.getBlocked(userId));
      }
      if (req.method !== 'PUT' && req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      const other = db.getUserByUsername(decodeURIComponent(pathSegments[1]));
      if (!other) return sendJson(res, 404, { error: 'User not found' });
      if (other.id === userId) return sendJson(res, 400, { error: "You can't block yourself" });
      if (req.method === 'PUT') db.blockUser(userId, other.id);
      else db.unblockUser(userId, other.id);
      sendToUser(userId, JSON.stringify({ type: 'blocks_changed' })); // my other tabs
      return sendJson(res, 200, { ok: true, blocked: req.method === 'PUT' });
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
      // P9-07a: not between people where either has blocked the other (it doesn't say which).
      if (db.eitherBlocked(fromId, to.id)) return sendJson(res, 403, { error: "You can't send this person a friend request" });
      // P11-09: at most 20 a day from one person.
      if (!rateLimitOk(`friend-request:${fromId}`, 20, 24 * 60 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'You’ve sent a lot of friend requests today. Try again tomorrow.' });
      }
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
